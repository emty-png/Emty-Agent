/**
 * Design project tools: start_project, edit_design, refresh_preview, get_console
 *
 * Used exclusively in 'design' mode. Manages static 3-file design projects
 * (index.html, styles.css, script.js) stored in ~/.emty/designs/{name}/.
 *
 * The preview renders via srcdoc with styles/script inlined; console output is
 * captured by an injected bootstrap script and relayed through postMessage.
 */

import type { FileReadRegistry } from './fs/shared'
import type { DesignProjectType } from '@/stores/chat/core/types'
import { homeDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { ConcurrencyLimitError, FileLockManager } from './fs/fileLock'
import { readTextSnapshot, updateReadRegistry } from './fs/shared'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

// ── Constants ────────────────────────────────────────────────────────────────

/** The only files a design project may contain. */
export const DESIGN_FILES = ['index.html', 'styles.css', 'script.js'] as const

/** Valid project names: lowercase letters/digits, then letters/digits/-/_ (max 64). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

// ── Console capture store (keyed by project path) ────────────────────────────

export type DesignConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface DesignConsoleEntry {
  level: DesignConsoleLevel
  args: string[]
  timestamp: number
}

const MAX_CONSOLE_ENTRIES = 500
const MAX_TRACKED_PROJECTS = 50

const consoleBuffers = new Map<string, DesignConsoleEntry[]>()

function getConsoleBuffer(projectPath: string): DesignConsoleEntry[] {
  let buffer = consoleBuffers.get(projectPath)
  if (!buffer) {
    buffer = []
    consoleBuffers.set(projectPath, buffer)
    // Prune the oldest tracked project when over budget (Map preserves order)
    if (consoleBuffers.size > MAX_TRACKED_PROJECTS) {
      const oldest = consoleBuffers.keys().next().value
      if (oldest !== undefined)
        consoleBuffers.delete(oldest)
    }
  }
  return buffer
}

export function pushConsoleEntries(projectPath: string, entries: DesignConsoleEntry[]): void {
  if (entries.length === 0)
    return
  const buffer = getConsoleBuffer(projectPath)
  buffer.push(...entries)
  if (buffer.length > MAX_CONSOLE_ENTRIES)
    buffer.splice(0, buffer.length - MAX_CONSOLE_ENTRIES)
}

export function clearConsoleBuffer(projectPath: string): void {
  consoleBuffers.delete(projectPath)
}

// ── Console bootstrap script (injected into preview srcdoc) ──────────────────

/**
 * Runs before any user code. Wraps console methods and global error handlers,
 * serializes arguments safely, and relays entries to the parent window via
 * postMessage. Kept as a plain string so it can be injected into srcdoc.
 */
export const CONSOLE_BOOTSTRAP = `<script>(function(){
  function ser(v, depth){
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      var t = typeof v;
      if (t === 'string') return v;
      if (t === 'number' || t === 'boolean') return String(v);
      if (t === 'function') return '[Function' + (v.name ? ': ' + v.name : '') + ']';
      if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
      if (typeof Element !== 'undefined' && v instanceof Element) return '<' + v.tagName.toLowerCase() + '\\u003E';
      if (depth > 3) return Array.isArray(v) ? '[Array]' : '{\\u2026}';
      if (Array.isArray(v)) {
        var parts = v.slice(0, 20).map(function(x){ return ser(x, depth + 1); });
        if (v.length > 20) parts.push('\\u2026 ' + (v.length - 20) + ' more');
        return '[' + parts.join(', ') + ']';
      }
      var keys = Object.keys(v).slice(0, 20);
      return '{' + keys.map(function(k){ return k + ': ' + ser(v[k], depth + 1); }).join(', ') + '}';
    } catch (e) { return '[unserializable]'; }
  }
  function send(level, args){
    try {
      var out = [];
      for (var i = 0; i < args.length; i++) {
        var s = ser(args[i], 0);
        out.push(s.length > 2000 ? s.slice(0, 2000) + '\\u2026' : s);
      }
      parent.postMessage({ source: 'emty-design-console', level: level, args: out, timestamp: Date.now() }, '*');
    } catch (e) { /* ignore */ }
  }
  ['log','info','warn','error','debug'].forEach(function(level){
    var original = typeof console[level] === 'function' ? console[level].bind(console) : function(){};
    console[level] = function(){ send(level, arguments); original.apply(null, arguments); };
  });
  window.addEventListener('error', function(e){
    var loc = e.lineno ? ' (' + e.lineno + ':' + e.colno + ')' : '';
    send('error', [(e.message || 'Script error') + loc]);
  });
  window.addEventListener('unhandledrejection', function(e){
    send('error', ['Unhandled promise rejection: ' + ser(e.reason, 0)]);
  });
})();<\/script>`

/** Inject the console bootstrap as the first child of <head> (or prepend). */
export function injectConsoleBootstrap(html: string): string {
  const headMatch = /<head[^>]*>/i.exec(html)
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length
    return html.slice(0, idx) + CONSOLE_BOOTSTRAP + html.slice(idx)
  }
  return CONSOLE_BOOTSTRAP + html
}

// ── Design picker bootstrap (inside-iframe, browser-style) ───────────────────

export const DESIGN_PICKER_SOURCE = 'emty-design-picker'
export const DESIGN_PICKER_HOST_SOURCE = 'emty-design-picker-host'

/**
 * Exact clone of the browser picker visuals (browser_bridge.js:333) but
 * running inside the design preview iframe via postMessage to the parent
 * DesignCanvas. No Tauri IPC — uses parent.postMessage for annotations
 * and listens for host commands (startPicker / stopPicker / setAnnotations).
 */
export const DESIGN_PICKER_BOOTSTRAP = `<script>(function(){
  var PICKER_ROOT_ID='__emty_design_picker__';
  var PICKER_STYLE_ID='__emty_design_picker_styles__';
  var pickerState={active:false,hovered:null,selected:null,root:null,hoverBox:null,markerLayer:null,composer:null,annotations:[],raf:0,markerListenersActive:false};
  function normalizeText(v){return String(v==null?'':v).replace(/\\s+/g,' ').trim();}
  function truncate(v,max){var t=normalizeText(v);return t.length>max?t.slice(0,max)+'...':t;}
  function truncateRaw(v,max){var t=String(v==null?'':v);return t.length>max?t.slice(0,max)+'...':t;}
  function isVisible(el){if(!(el instanceof HTMLElement))return false;var r=el.getBoundingClientRect();var s=window.getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}
  function elementText(el){return normalizeText(el.getAttribute('aria-label')||el.innerText||el.textContent||'');}
  function elementRole(el){return el.getAttribute('role')||null;}
  function elementIdentifier(el){if(el.id)return '#'+el.id;if(el.getAttribute('name'))return el.tagName.toLowerCase()+'[name="'+el.getAttribute('name')+'"]';if(el.classList.length>0)return el.tagName.toLowerCase()+'.'+Array.prototype.slice.call(el.classList,0,2).join('.');return el.tagName.toLowerCase();}
  function cssEscape(value){if(window.CSS&&typeof window.CSS.escape==='function')return window.CSS.escape(String(value));return String(value).replace(/[^a-zA-Z0-9_-]/g,function(ch){return '\\\\'+ch});}
  function selectorForElement(el){if(!(el instanceof Element))return '';if(el.id)return '#'+cssEscape(el.id);var parts=[];var cur=el;while(cur&&cur instanceof Element&&cur!==document.documentElement){var part=cur.tagName.toLowerCase();var parent=cur.parentElement;if(!parent)break;var same=Array.prototype.slice.call(parent.children).filter(function(c){return c.tagName===cur.tagName});if(same.length>1)part+=':nth-of-type('+(same.indexOf(cur)+1)+')';parts.unshift(part);if(parts.length>=6)break;cur=parent;}return parts.join(' > ')||elementIdentifier(el);}
  function elementAttributes(el){var out={};var attrs=Array.prototype.slice.call(el.attributes||[]);for(var i=0;i<attrs.length;i++){var a=attrs[i];out[a.name]=truncateRaw(a.value,300);}return out;}
  function describeElement(el,opts){opts=opts||{};var r=el.getBoundingClientRect();var needsMax=opts.maxHtmlChars==null?4000:opts.maxHtmlChars;var val='value' in el?String(el.value==null?'':el.value):'';var checked='checked' in el?Boolean(el.checked):undefined;return {tag:el.tagName.toLowerCase(),id:el.id||null,classes:Array.prototype.slice.call(el.classList),name:el.getAttribute('name'),role:elementRole(el),ariaLabel:el.getAttribute('aria-label'),selector:selectorForElement(el),selectorHint:elementIdentifier(el),text:truncate(elementText(el),220),href:el instanceof HTMLAnchorElement?el.href:null,attributes:elementAttributes(el),outerHTML:truncateRaw(el.outerHTML||'',needsMax),placeholder:el.getAttribute('placeholder'),type:'type' in el?String(el.type==null?'':el.type):null,disabled:'disabled' in el?Boolean(el.disabled):false,checked:checked,valuePreview:val?truncate(val,120):null,rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}};}
  function installPickerStyles(){if(document.getElementById(PICKER_STYLE_ID))return;var s=document.createElement('style');s.id=PICKER_STYLE_ID;s.textContent='#'+PICKER_ROOT_ID+'{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8fbff} #'+PICKER_ROOT_ID+' *{box-sizing:border-box} .emty-picker-hover,.emty-picker-marker-box{position:fixed;border:2px solid #178cff;background:rgba(23,140,255,0.16);box-shadow:0 0 0 1px rgba(255,255,255,0.76),0 10px 32px rgba(0,0,0,0.18);pointer-events:none} .emty-picker-hover{display:none} .emty-picker-pin,.emty-picker-marker-pin{position:fixed;display:grid;place-items:center;width:22px;height:22px;border:2px solid #ffffff;border-radius:999px;background:#178cff;box-shadow:0 6px 18px rgba(0,0,0,0.25);pointer-events:none} .emty-picker-pin::before,.emty-picker-marker-pin::before{content:"";width:8px;height:8px;border-radius:999px;background:#ffffff} .emty-picker-composer{position:fixed;width:min(300px,calc(100vw - 24px));border:1px solid #262626;border-radius:12px;background:#0a0a0a;box-shadow:0 12px 32px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.3);padding:6px;pointer-events:auto} .emty-picker-composer-row{display:flex;align-items:center;gap:8px} .emty-picker-comment{flex:1;min-width:0;height:28px;box-sizing:border-box;border:1px solid #333333;border-radius:8px;outline:0;resize:none;background:#141414;color:#f2f2f2;font:inherit;font-size:12px;line-height:20px;padding:4px 8px;transition:border-color 150ms ease} .emty-picker-comment:focus{border-color:#00e5ff} .emty-picker-comment::placeholder{color:#595959} .emty-picker-action,.emty-picker-cancel{display:grid;place-items:center;width:28px;height:28px;flex-shrink:0;border:1px solid #333333;border-radius:8px;background:#141414;color:#8a8a8a;cursor:pointer;font:inherit;transition:background 100ms cubic-bezier(0.4,0,0.2,1),border-color 100ms cubic-bezier(0.4,0,0.2,1),color 100ms cubic-bezier(0.4,0,0.2,1)} .emty-picker-cancel:hover{background:#1c1c1c;color:#f2f2f2} .emty-picker-cancel:active{transform:scale(0.97)} .emty-picker-action:disabled{cursor:default;opacity:0.45} .emty-picker-action:not(:disabled){border-color:rgba(0,229,255,0.4);background:rgba(0,229,255,0.18);color:#00e5ff} .emty-picker-action:not(:disabled):hover{background:rgba(0,229,255,0.28)} .emty-picker-action:not(:disabled):active{transform:scale(0.97)} .emty-picker-marker-note{position:fixed;max-width:260px;padding:7px 10px;border-radius:12px;background:#178cff;color:#ffffff;font-size:12px;font-weight:600;line-height:1.35;box-shadow:0 8px 22px rgba(0,0,0,0.25);pointer-events:none}';(document.head||document.documentElement).appendChild(s);}
  function ensurePickerRoot(){installPickerStyles();if(pickerState.root&&document.documentElement.contains(pickerState.root))return pickerState.root;var root=document.createElement('div');root.id=PICKER_ROOT_ID;var hoverBox=document.createElement('div');hoverBox.className='emty-picker-hover';var pin=document.createElement('div');pin.className='emty-picker-pin';hoverBox.appendChild(pin);var markerLayer=document.createElement('div');markerLayer.className='emty-picker-marker-layer';root.appendChild(markerLayer);root.appendChild(hoverBox);document.documentElement.appendChild(root);pickerState.root=root;pickerState.hoverBox=hoverBox;pickerState.markerLayer=markerLayer;return root;}
  function isPickerElement(n){return n instanceof Element&&!!n.closest('#'+PICKER_ROOT_ID);}
  function elementFromPointer(e){var el=document.elementFromPoint(e.clientX,e.clientY);if(!el||isPickerElement(el)||el===document.documentElement||el===document.body)return null;return el;}
  function positionBox(box,rect){var left=rect.left;var top=rect.top;var width=rect.width;var height=rect.height;var right=rect.right;box.style.display='block';box.style.left=Math.max(0,Math.round(left))+'px';box.style.top=Math.max(0,Math.round(top))+'px';box.style.width=Math.max(1,Math.round(width))+'px';box.style.height=Math.max(1,Math.round(height))+'px';var pin=box.querySelector('.emty-picker-pin, .emty-picker-marker-pin');if(pin){pin.style.left=Math.min(window.innerWidth-26,Math.max(4,Math.round(right-12)))+'px';pin.style.top=Math.min(window.innerHeight-26,Math.max(4,Math.round(top+height/2-11)))+'px';}}
  function updateHoverBox(){if(!pickerState.hoverBox||!pickerState.hovered)return;positionBox(pickerState.hoverBox,pickerState.hovered.getBoundingClientRect());}
  function hideHoverBox(){if(pickerState.hoverBox)pickerState.hoverBox.style.display='none';}
  function scheduleMarkerRender(){if(pickerState.raf)return;pickerState.raf=window.requestAnimationFrame(function(){pickerState.raf=0;renderPickerMarkers();updateHoverBox();});}
  function syncMarkerListeners(){var should=pickerState.active||pickerState.annotations.length>0;if(should===pickerState.markerListenersActive)return;pickerState.markerListenersActive=should;var m=should?'addEventListener':'removeEventListener';window[m]('scroll',scheduleMarkerRender,true);window[m]('resize',scheduleMarkerRender,true);}
  function renderPickerMarkers(){ensurePickerRoot();var layer=pickerState.markerLayer;if(!layer)return;layer.textContent='';for(var i=0;i<pickerState.annotations.length;i++){var ann=pickerState.annotations[i];if(!ann||!ann.element||!ann.element.selector)continue;var el=null;try{el=document.querySelector(ann.element.selector);}catch(e){el=null;}if(!el||!isVisible(el))continue;var rect=el.getBoundingClientRect();var box=document.createElement('div');box.className='emty-picker-marker-box';var p=document.createElement('div');p.className='emty-picker-marker-pin';box.appendChild(p);positionBox(box,rect);var note=document.createElement('div');note.className='emty-picker-marker-note';note.textContent=truncate(ann.comment,90);note.style.left=Math.min(window.innerWidth-272,Math.max(8,Math.round(rect.left)))+'px';note.style.top=Math.min(window.innerHeight-48,Math.max(8,Math.round(rect.bottom+8)))+'px';layer.appendChild(box);layer.appendChild(note);}}
  function removeComposer(){if(pickerState.composer){pickerState.composer.remove();pickerState.composer=null;}pickerState.selected=null;}
  function showComposerFor(el){ensurePickerRoot();removeComposer();pickerState.selected=el;var rect=el.getBoundingClientRect();var c=document.createElement('div');c.className='emty-picker-composer';c.innerHTML='<div class="emty-picker-composer-row"><button class="emty-picker-cancel" type="button" aria-label="Cancel annotation"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button><textarea class="emty-picker-comment" rows="1" placeholder="Add a comment..."></textarea><button class="emty-picker-action" type="button" aria-label="Attach comment" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button></div>';var left=Math.min(window.innerWidth-332,Math.max(12,rect.left+rect.width/2-160));var below=rect.bottom+10;var top=below+58<window.innerHeight?below:Math.max(12,rect.top-58);c.style.left=left+'px';c.style.top=top+'px';var ta=c.querySelector('.emty-picker-comment');var act=c.querySelector('.emty-picker-action');var canc=c.querySelector('.emty-picker-cancel');ta.addEventListener('input',function(){act.disabled=ta.value.trim().length===0;});ta.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();removeComposer();}if((e.key==='Enter'&&(e.metaKey||e.ctrlKey))||(e.key==='Enter'&&!e.shiftKey)){e.preventDefault();submitPickerComment(ta.value);}});act.addEventListener('click',function(){submitPickerComment(ta.value);});canc.addEventListener('click',removeComposer);pickerState.root.appendChild(c);pickerState.composer=c;setTimeout(function(){ta.focus();},0);}
  function makePickerId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return 'design-element-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
  function submitPickerComment(raw){var comment=normalizeText(raw);var el=pickerState.selected;if(!comment||!el)return;var ann={id:makePickerId(),comment:comment,url:window.location.href,title:document.title,createdAt:Date.now(),element:describeElement(el,{maxHtmlChars:6000})};pickerState.annotations.push(ann);removeComposer();renderPickerMarkers();try{parent.postMessage({source:'emty-design-picker',kind:'annotation',annotation:ann},'*');}catch(e){}}
  function onPickerPointerMove(e){if(!pickerState.active||pickerState.composer)return;var el=elementFromPointer(e);if(el===pickerState.hovered)return;pickerState.hovered=el;if(!el){hideHoverBox();return;}updateHoverBox();}
  function onPickerPointerDown(e){if(!pickerState.active)return;if(isPickerElement(e.target))return;var el=elementFromPointer(e);if(!el)return;e.preventDefault();e.stopPropagation();showComposerFor(el);}
  function onPickerClick(e){if(!pickerState.active||isPickerElement(e.target))return;e.preventDefault();e.stopPropagation();}
  function onPickerKeydown(e){if(!pickerState.active)return;if(e.key==='Escape'){e.preventDefault();stopPicker();}}
  function startPicker(){ensurePickerRoot();if(pickerState.active)return;pickerState.active=true;document.addEventListener('pointermove',onPickerPointerMove,true);document.addEventListener('pointerdown',onPickerPointerDown,true);document.addEventListener('click',onPickerClick,true);document.addEventListener('keydown',onPickerKeydown,true);syncMarkerListeners();renderPickerMarkers();}
  function stopPicker(){if(!pickerState.active)return;pickerState.active=false;pickerState.hovered=null;document.removeEventListener('pointermove',onPickerPointerMove,true);document.removeEventListener('pointerdown',onPickerPointerDown,true);document.removeEventListener('click',onPickerClick,true);document.removeEventListener('keydown',onPickerKeydown,true);removeComposer();hideHoverBox();syncMarkerListeners();}
  function setAnnotations(list){pickerState.annotations=Array.isArray(list)?list:[];renderPickerMarkers();syncMarkerListeners();}
  window.__EMTY_DESIGN_PICKER__={start:startPicker,stop:stopPicker,setAnnotations:setAnnotations};
  window.addEventListener('message',function(e){try{var d=e.data;if(!d||d.source!=='emty-design-picker-host')return;if(d.action==='startPicker')startPicker();else if(d.action==='stopPicker')stopPicker();else if(d.action==='setAnnotations')setAnnotations(d.annotations||[]);}catch(err){}});
})();<\/script>`

export function injectPickerBootstrap(html: string): string {
  // Insert picker bootstrap right after console bootstrap if present, else after <head>.
  const consoleIdx = html.indexOf(CONSOLE_BOOTSTRAP)
  if (consoleIdx !== -1) {
    const insertAt = consoleIdx + CONSOLE_BOOTSTRAP.length
    return html.slice(0, insertAt) + DESIGN_PICKER_BOOTSTRAP + html.slice(insertAt)
  }
  // Fallback: console marker exists but CONSOLE_BOOTSTRAP not matched verbatim (e.g. minified) — find the first </script> after the marker
  if (html.includes('emty-design-console')) {
    const markerIdx = html.indexOf('emty-design-console')
    const closeIdx = html.indexOf('</script>', markerIdx)
    if (closeIdx !== -1) {
      const insertAt = closeIdx + '</script>'.length
      return html.slice(0, insertAt) + DESIGN_PICKER_BOOTSTRAP + html.slice(insertAt)
    }
  }
  const headMatch = /<head[^>]*>/i.exec(html)
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length
    return html.slice(0, idx) + DESIGN_PICKER_BOOTSTRAP + html.slice(idx)
  }
  return DESIGN_PICKER_BOOTSTRAP + html
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getDesignsRoot(): Promise<string> {
  const home = await homeDir()
  return join(home, '.emty', 'designs')
}

async function ensureDir(dirPath: string): Promise<void> {
  if (!(await exists(dirPath)))
    await mkdir(dirPath, { recursive: true })
}

async function writeFile(filePath: string, content: string): Promise<void> {
  // Handle both forward and back slashes for Windows compatibility
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : ''
  if (dir)
    await ensureDir(dir)
  await writeTextFile(filePath, content)
}

// ── Project templates ────────────────────────────────────────────────────────

function getTemplateFiles(name: string): Array<{ path: (typeof DESIGN_FILES)[number]; content: string }> {
  const title = name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="starter">
    <h1>${title}</h1>
    <p>Edit these files to begin building your design.</p>
  </main>
  <script src="script.js"><\/script>
</body>
</html>
`

  const stylesCss = `/* ${title} — styles */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #fafafa;
  color: #111;
}

.starter {
  text-align: center;
  padding: 48px 32px;
}

.starter h1 {
  font-size: clamp(28px, 5vw, 44px);
  letter-spacing: -0.02em;
}

.starter p {
  margin-top: 12px;
  color: #666;
}
`

  const scriptJs = `// ${title} — scripts
console.log('Design project ready')
`

  return [
    { path: 'index.html', content: indexHtml },
    { path: 'styles.css', content: stylesCss },
    { path: 'script.js', content: scriptJs },
  ]
}

// ── start_project ────────────────────────────────────────────────────────────

export function createStartProjectTool(
  onProjectScaffold?: (project: { path: string; name: string; type: DesignProjectType }) => void,
  onVersionAccumulate?: (files: Array<{ path: string; content: string }>) => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.start_project,
    inputSchema: zodSchema(z.object({
      name: z.string().regex(NAME_PATTERN, 'Project name must be lowercase (letters, digits, "-" or "_"), start with a letter or digit, max 64 chars — e.g. "login_page"'),
      overwrite: z.boolean().optional().describe('Set true to replace an existing project with the same name'),
    })),
    execute: async ({ name, overwrite }) => {
      console.warn(`[start_project] ── START ── name=${JSON.stringify(name)} overwrite=${!!overwrite}`)
      try {
        const designsRoot = await getDesignsRoot()
        const projectPath = await join(designsRoot, name)

        if (await exists(projectPath) && !overwrite) {
          const msg = `A project named "${name}" already exists. Pick a different name, or pass overwrite: true to replace it.`
          console.warn(`[start_project] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        await ensureDir(projectPath)
        clearConsoleBuffer(projectPath)

        for (const file of getTemplateFiles(name)) {
          await writeFile(await join(projectPath, file.path), file.content)
          console.warn(`[start_project] ✓ Created ${file.path}`)
        }

        onProjectScaffold?.({ path: projectPath, name, type: 'multiple-files' })
        const templateFiles = getTemplateFiles(name)
        onVersionAccumulate?.(templateFiles.map(f => ({ path: f.path, content: f.content })))

        console.warn(`[start_project] ✓ Project ready at ${projectPath}`)
        return {
          ok: true,
          path: projectPath,
          files: [...DESIGN_FILES],
          message: `Project "${name}" created at ${projectPath} with index.html, styles.css and script.js. The live preview has started. Use edit_design to make changes.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[start_project] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `start_project failed: ${detail}` }
      }
    },
  })
}

// ── edit_design ──────────────────────────────────────────────────────────────

type ActiveProjectGetter = () => { path: string; name: string; type: DesignProjectType } | null

export function createEditDesignTool(
  getActiveDesignProject?: ActiveProjectGetter,
  onFilesChanged?: () => void,
  onVersionAccumulate?: (files: Array<{ path: string; content: string }>) => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.edit_design,
    inputSchema: zodSchema(z.object({
      files: z.array(z.object({
        path: z.enum(['index.html', 'styles.css', 'script.js'])
          .describe('File to edit relative to the project root'),
        content: z.string().describe('Full new file content'),
      })).min(1).max(3).describe('Files to write (full content per file)'),
    })),
    execute: async ({ files }) => {
      console.warn(`[edit_design] ── START ── files=${files.length}`)
      try {
        const project = getActiveDesignProject?.()
        if (!project) {
          const msg = 'No active design project. Call start_project first.'
          console.warn(`[edit_design] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        const results: Array<{ path: string; ok: boolean; skipped?: boolean; error?: string }> = []

        for (const file of files) {
          try {
            const fullPath = await join(project.path, file.path)
            let unchanged = false
            try {
              if (await exists(fullPath))
                unchanged = (await readTextFile(fullPath)) === file.content
            }
            catch { /* treat as changed */ }

            if (unchanged) {
              results.push({ path: file.path, ok: true, skipped: true })
              console.warn(`[edit_design] ⊘ ${file.path} unchanged, skipping`)
              continue
            }

            await writeFile(fullPath, file.content)
            results.push({ path: file.path, ok: true })
            console.warn(`[edit_design] ✓ wrote ${file.path} (${file.content.length} bytes)`)
          }
          catch (e) {
            const error = e instanceof Error ? e.message : String(e)
            results.push({ path: file.path, ok: false, error })
            console.warn(`[edit_design] ✗ failed ${file.path}: ${error}`)
          }
        }

        const failed = results.filter(r => !r.ok)
        const written = results.filter(r => r.ok && !r.skipped)

        if (written.length > 0 && failed.length === 0) {
          onFilesChanged?.()
          const writtenFiles = files.filter(f => written.some(w => w.path === f.path))
          onVersionAccumulate?.(writtenFiles.map(f => ({ path: f.path, content: f.content })))
        }

        return {
          ok: failed.length === 0,
          written: written.length,
          skipped: results.filter(r => r.skipped).length,
          errors: failed.length > 0 ? failed.map(f => `${f.path}: ${f.error}`) : undefined,
          message: failed.length === 0
            ? `${written.length} file(s) written${written.length > 0 ? ' — preview reloaded' : ', nothing changed'}`
            : `Failed: ${failed.map(f => f.path).join(', ')}`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[edit_design] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `edit_design failed: ${detail}` }
      }
    },
  })
}

// ── refresh_preview ──────────────────────────────────────────────────────────

export function createRefreshPreviewTool(
  getActiveDesignProject?: ActiveProjectGetter,
  onFilesChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.refresh_preview,
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      console.warn('[refresh_preview] ── START ──')
      try {
        const project = getActiveDesignProject?.()
        if (!project) {
          const msg = 'No active design project. Call start_project first.'
          console.warn(`[refresh_preview] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        onFilesChanged?.()
        console.warn(`[refresh_preview] ✓ Preview refreshed for ${project.name}`)
        return { ok: true, message: `Preview refreshed for "${project.name}".` }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[refresh_preview] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `refresh_preview failed: ${detail}` }
      }
    },
  })
}

// ── get_console ──────────────────────────────────────────────────────────────

export function createGetConsoleTool(getActiveDesignProject?: ActiveProjectGetter) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.get_console,
    inputSchema: zodSchema(z.object({
      level: z.enum(['all', 'log', 'info', 'warn', 'error']).optional().describe('Filter by log level (default "all")'),
      limit: z.number().int().min(1).max(200).optional().describe('Max entries to return, newest last (default 50)'),
    })),
    execute: async ({ level, limit }) => {
      console.warn(`[get_console] ── START ── level=${level ?? 'all'} limit=${limit ?? 50}`)
      try {
        const project = getActiveDesignProject?.()
        if (!project) {
          const msg = 'No active design project. Call start_project first.'
          console.warn(`[get_console] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        const buffer = consoleBuffers.get(project.path) ?? []
        const filtered = (!level || level === 'all')
          ? buffer
          : buffer.filter(entry => entry.level === level)
        const max = Math.min(limit ?? 50, 200)
        const entries = filtered.slice(-max)

        const counts = {
          total: buffer.length,
          errors: buffer.filter(e => e.level === 'error').length,
          warnings: buffer.filter(e => e.level === 'warn').length,
        }

        console.warn(`[get_console] ✓ Returning ${entries.length}/${filtered.length} entries`)
        return {
          ok: true,
          counts,
          entries,
          message: entries.length === 0
            ? 'No console output captured yet.'
            : `${entries.length} of ${filtered.length} matching entr${filtered.length === 1 ? 'y' : 'ies'} (${counts.total} total, ${counts.errors} errors, ${counts.warnings} warnings), oldest first.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[get_console] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `get_console failed: ${detail}` }
      }
    },
  })
}

// ── read_design ─────────────────────────────────────────────────────────────

const read_design_DEFAULT_LIMIT = 300
const read_design_MAX_LIMIT = 2000

export function createReadDesignTool(getActiveDesignProject?: ActiveProjectGetter) {
  const registry: FileReadRegistry = new Map()
  const lockManager = new FileLockManager()

  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.read_design,
    inputSchema: zodSchema(z.object({
      file_paths: z.array(z.enum(['index.html', 'styles.css', 'script.js'])).min(1).describe('Design files to read relative to the project root'),
      offset: z.number().int().min(1).optional().describe('The 1-based line number to start reading from. Omit to start from line 1. Only needed when paginating through a truncated file.'),
      limit: z.number().int().min(1).max(read_design_MAX_LIMIT).optional().describe(`Max lines to return per file. Default: ${read_design_DEFAULT_LIMIT}, max: ${read_design_MAX_LIMIT}. Omit unless you need a specific range.`),
    })),
    execute: async ({ file_paths, offset, limit }) => {
      console.warn(`[read_design] ── START ── files=${file_paths.length}`)
      try {
        const project = getActiveDesignProject?.()
        if (!project) {
          const msg = 'No active design project. Call start_project first.'
          console.warn(`[read_design] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        const start = offset !== undefined ? offset - 1 : 0
        const appliedLimit = Math.min(limit ?? read_design_DEFAULT_LIMIT, read_design_MAX_LIMIT)
        const projectPath = project.path

        async function readOne(filePath: string): Promise<string> {
          const fullPath = await join(projectPath, filePath)

          try {
            return await lockManager.withReadLock(fullPath, async () => {
              let snapshot: Awaited<ReturnType<typeof readTextSnapshot>>
              try {
                snapshot = await readTextSnapshot(fullPath)
              }
              catch (e) {
                const error = e instanceof Error ? e.message : String(e)
                return `Error: Cannot read ${filePath}: ${error}`
              }

              const allLines = snapshot.content.length === 0 ? [] : snapshot.content.split('\n')
              const totalLines = allLines.length
              const collected = allLines.slice(start, start + appliedLimit)
              const truncated = totalLines > start + collected.length
              const oneBasedOffset = start + 1

              // Registry update — always record; no deduplication stub
              updateReadRegistry(registry, fullPath, {
                hash: snapshot.hash,
                complete: !truncated,
                sizeBytes: snapshot.sizeBytes,
                mtimeMs: snapshot.mtimeMs,
                offset: oneBasedOffset,
                limit: appliedLimit,
              })

              let output = collected
                .map((line, i) => `${String(start + i + 1).padStart(String(start + collected.length).length)}\t${line}`)
                .join('\n')

              if (truncated) {
                output += `\n\n(File truncated. Showing lines ${start + 1}\u2013${start + collected.length} of ${totalLines}. Use offset and limit to read more.)`
              }

              return output
            })
          }
          catch (e) {
            if (e instanceof ConcurrencyLimitError)
              return `Error: ${e.message}. Too many parallel tool calls — wait for some to finish and retry.`
            throw e
          }
        }

        if (file_paths.length === 1) {
          const content = await readOne(file_paths[0]!)
          console.warn(`[read_design] ✓ Read ${file_paths[0]}`)
          return { ok: true, file: file_paths[0], content }
        }

        const parts: string[] = []
        for (const filePath of file_paths)
          parts.push(`=== ${filePath} ===\n${await readOne(filePath)}`)

        console.warn(`[read_design] ✓ Read ${file_paths.length} files`)
        return { ok: true, files: [...file_paths], content: parts.join('\n\n') }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[read_design] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `read_design failed: ${detail}` }
      }
    },
  })
}

// ── Display labels ───────────────────────────────────────────────────────────

export function designProjectToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  if (name === 'start_project') {
    const projectName = typeof args.name === 'string' ? args.name : ''
    return projectName ? `Starting project "${projectName}"` : 'Starting project'
  }
  if (name === 'edit_design') {
    const files = Array.isArray(args.files) ? args.files : []
    return `Editing ${files.length} file${files.length !== 1 ? 's' : ''}`
  }
  if (name === 'refresh_preview')
    return 'Refreshing preview'
  if (name === 'get_console')
    return 'Reading console output'
  if (name === 'read_design') {
    const files = Array.isArray(args.file_paths)
      ? args.file_paths.filter((f): f is string => typeof f === 'string')
      : []
    return files.length === 1 ? `Reading ${files[0]}` : `Reading ${files.length} files`
  }
  return `Called ${name}`
}
