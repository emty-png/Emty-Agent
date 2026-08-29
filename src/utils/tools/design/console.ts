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

// Expose map for get_console aggregation (internal)
export { consoleBuffers }

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

export function injectConsoleBootstrap(html: string): string {
  const headMatch = /<head[^>]*>/i.exec(html)
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length
    return html.slice(0, idx) + CONSOLE_BOOTSTRAP + html.slice(idx)
  }
  return CONSOLE_BOOTSTRAP + html
}
