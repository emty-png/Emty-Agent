import { CONSOLE_BOOTSTRAP } from './console'
import { DESIGN_PICKER_BOOTSTRAP } from './picker'

export const DESIGN_SCREENSHOT_SOURCE = 'emty-design-screenshot'
export const DESIGN_SCREENSHOT_HOST_SOURCE = 'emty-design-screenshot-host'

export const DESIGN_SCREENSHOT_BOOTSTRAP = `<script>(function(){
  var HOST_SOURCE='${DESIGN_SCREENSHOT_HOST_SOURCE}';
  var SOURCE='${DESIGN_SCREENSHOT_SOURCE}';
  async function waitForReady(){
    try{ if(document.fonts && document.fonts.ready) await document.fonts.ready; }catch(e){}
    await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
    // wait for images
    var imgs = Array.prototype.slice.call(document.images || []);
    await Promise.all(imgs.map(function(img){
      if(img.complete) return Promise.resolve();
      return new Promise(function(res){
        var t = setTimeout(res, 1500);
        img.addEventListener('load', function(){ clearTimeout(t); res(); }, {once:true});
        img.addEventListener('error', function(){ clearTimeout(t); res(); }, {once:true});
      });
    }));
  }
  function renderFallbackCanvas(width,height,reason){
    try{
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(320, Math.min(width||960, 1600));
      canvas.height = Math.max(480, Math.min(height||720, 1200));
      var ctx = canvas.getContext('2d');
      if(!ctx) return null;
      ctx.fillStyle = '#f5f7fb';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#ffffff';
      var pad=24;
      ctx.fillRect(pad,pad,canvas.width-pad*2,canvas.height-pad*2);
      ctx.strokeStyle='#e5e7eb';
      ctx.strokeRect(pad,pad,canvas.width-pad*2,canvas.height-pad*2);
      ctx.fillStyle='#6b7280';
      ctx.font='12px system-ui, sans-serif';
      try{ ctx.fillText('Screenshot fallback: '+(reason||'unknown'), pad+16, pad+36); }catch(e){}
      ctx.fillStyle='#111827';
      ctx.font='13px system-ui, sans-serif';
      var txt=(document.body && document.body.innerText ? document.body.innerText.slice(0,1800) : document.documentElement.innerText.slice(0,1800)) || 'No content';
      var lines=txt.split('\\n').slice(0,12);
      for(var i=0;i<lines.length;i++) try{ ctx.fillText(lines[i].slice(0,120), pad+16, pad+64+i*18); }catch(e){}
      try{
        return canvas.toDataURL('image/png');
      }catch(e){
        // Tainted fallback should never happen, but return 1x1 pixel as ultimate fallback
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      }
    }catch(e){ return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; }
  }
  function isExternalUrl(url){
    if(!url) return false;
    if(url.indexOf('data:')===0 || url.indexOf('blob:')===0) return false;
    if(url.indexOf('http://')===0 || url.indexOf('https://')===0 || url.indexOf('//')===0) {
      try{
        var a=document.createElement('a');
        a.href=url;
        // same-origin check: if origin differs, treat as external
        return a.origin !== window.location.origin;
      }catch(e){ return true; }
    }
    return false; // relative URLs are safe (inlined styles/scripts)
  }
  function stripExternalUrlsFromCss(css){
    try{
      // 1) Remove external @import entirely (before touching url() inside it)
      var cleaned = css.replace(/@import\\s+[^;]*;/gi, function(m){
        var low = m.toLowerCase();
        if(low.indexOf('http://')!==-1 || low.indexOf('https://')!==-1 || low.indexOf('//')!==-1){
          // keep font imports
          if(low.indexOf('.woff')!==-1 || low.indexOf('fonts.googleapis')!==-1 || low.indexOf('fonts.gstatic')!==-1) return m;
          return '/* external @import removed */';
        }
        return m;
      });
      // 2) Replace external url(...) with none, keep data/blob and font files + google fonts css
      cleaned = cleaned.replace(/url\\s*\\([^)]*\\)/gi, function(m){
        var low = m.toLowerCase();
        if(low.indexOf('data:')!==-1 || low.indexOf('blob:')!==-1) return m;
        // keep font urls - they don't taint canvas even if external
        if(low.indexOf('.woff')!==-1 || low.indexOf('.ttf')!==-1 || low.indexOf('.otf')!==-1) return m;
        if(low.indexOf('fonts.googleapis')!==-1 || low.indexOf('fonts.gstatic')!==-1) return m;
        if(m.indexOf('http://')!==-1 || m.indexOf('https://')!==-1 || m.indexOf('//')!==-1){
          return 'none';
        }
        return m;
      });
      return cleaned;
    }catch(e){ return css; }
  }
  async function captureViaForeignObject(width,height){
    var docEl = document.documentElement;
    // clone
    var clone = docEl.cloneNode(true);
    // remove scripts to avoid re-execution
    var scripts = clone.querySelectorAll('script');
    for(var i=0;i<scripts.length;i++) scripts[i].remove();
    // Sanitize external resources that would taint canvas (cross-origin without CORS)
    try{
      // 1. Remove external stylesheet links (any remaining href with http)
      var links = clone.querySelectorAll('link');
      for(var i=0;i<links.length;i++){
        var href = links[i].getAttribute('href') || '';
        var rel = (links[i].getAttribute('rel') || '').toLowerCase();
        if(isExternalUrl(href)){
          // keep font preconnect / google fonts? Remove to avoid taint - fonts not needed for non-taint but safer to remove external stylesheets that contain images
          // If it's a font stylesheet, keep it - check href
          var lowHref = href.toLowerCase();
          if(lowHref.indexOf('fonts.googleapis')!==-1 || lowHref.indexOf('fonts.gstatic')!==-1){
            continue;
          }
          try{ links[i].parentNode.removeChild(links[i]); }catch(e){}
        } else if(rel === 'stylesheet' && href && href.indexOf('styles.css')===-1){
          // relative stylesheet that wasn't inlined - if it's not styles.css, it might be external via relative path that would 404; remove to avoid unexpected load
          // keep it if it's styles.css (already handled) else remove
          // actually styles.css already inlined, so any remaining link is extraneous
          try{ links[i].parentNode.removeChild(links[i]); }catch(e){}
        }
      }
      // 2. Scrub <style> blocks for external url()
      var styleTags = clone.querySelectorAll('style');
      for(var i=0;i<styleTags.length;i++){
        var css = styleTags[i].textContent || '';
        var cleaned = stripExternalUrlsFromCss(css);
        if(cleaned !== css) styleTags[i].textContent = cleaned;
      }
      // 3. Replace external images with placeholder
      var imgs = clone.querySelectorAll('img');
      for(var i=0;i<imgs.length;i++){
        var imgEl = imgs[i];
        var src = imgEl.getAttribute('src') || '';
        var srcset = imgEl.getAttribute('srcset') || '';
        var hasExternalSrc = isExternalUrl(src);
        var hasExternalSrcset = srcset && (srcset.indexOf('http://')!==-1 || srcset.indexOf('https://')!==-1 || srcset.indexOf('//')!==-1);
        if(hasExternalSrc || hasExternalSrcset){
          // Preserve dimensions for layout
          var w = parseInt(imgEl.getAttribute('width') || '', 10) || imgEl.width || 120;
          var h = parseInt(imgEl.getAttribute('height') || '', 10) || imgEl.height || 80;
          // Try to infer from computed style if available in clone context (best-effort)
          try{
            var styleAttr = imgEl.getAttribute('style') || '';
            var wMatch = /width\\s*:\\s*(\\d+)px/i.exec(styleAttr);
            var hMatch = /height\\s*:\\s*(\\d+)px/i.exec(styleAttr);
            if(wMatch) w = parseInt(wMatch[1],10) || w;
            if(hMatch) h = parseInt(hMatch[1],10) || h;
          }catch(e){}
          w = Math.max(24, Math.min(w, width));
          h = Math.max(24, Math.min(h, height));
          var placeholder = document.createElement('div');
          placeholder.setAttribute('style','display:inline-flex;align-items:center;justify-content:center;width:'+w+'px;height:'+h+'px;max-width:100%;background:#e5e7eb;border:1px solid #d1d5db;color:#6b7280;font:11px system-ui,sans-serif;border-radius:6px;');
          placeholder.textContent='[image]';
          if(imgEl.parentNode) imgEl.parentNode.replaceChild(placeholder, imgEl);
        } else {
          try{ imgEl.removeAttribute('crossorigin'); }catch(e){}
        }
      }
      // Handle <picture><source> with external srcset
      var sources = clone.querySelectorAll('source');
      for(var i=0;i<sources.length;i++){
        var sSrc = sources[i].getAttribute('src') || '';
        var sSrcset = sources[i].getAttribute('srcset') || '';
        if(isExternalUrl(sSrc) || (sSrcset && (sSrcset.indexOf('http://')!==-1 || sSrcset.indexOf('https://')!==-1 || sSrcset.indexOf('//')!==-1))){
          try{ sources[i].parentNode.removeChild(sources[i]); }catch(e){}
        }
      }
      // Handle SVG <image> elements
      var svgImages = clone.querySelectorAll('image');
      for(var i=0;i<svgImages.length;i++){
        var href = svgImages[i].getAttribute('href') || svgImages[i].getAttribute('xlink:href') || '';
        if(isExternalUrl(href)){
          try{ svgImages[i].parentNode.removeChild(svgImages[i]); }catch(e){}
        }
      }
      // 4. Strip external background images in inline styles
      var all = clone.querySelectorAll('*');
      for(var i=0;i<all.length;i++){
        var el = all[i];
        var style = el.getAttribute('style') || '';
        if(style && style.indexOf('url(')!==-1){
          if(style.indexOf('http://')!==-1 || style.indexOf('https://')!==-1 || style.indexOf('//')!==-1){
            try{
              var cleanedInline = stripExternalUrlsFromCss(style);
              // If still contains external url after generic clean, wipe background
              if(cleanedInline.indexOf('http')!==-1 && cleanedInline.indexOf('url(')!==-1){
                el.style.backgroundImage='none';
                el.style.background='none';
              }
              el.setAttribute('style', cleanedInline);
            }catch(e){
              try{ el.style.backgroundImage='none'; el.style.background='none'; }catch(_){}
            }
          }
        }
        // Remove external poster attributes
        var poster = el.getAttribute('poster');
        if(poster && isExternalUrl(poster)) try{ el.removeAttribute('poster'); }catch(e){}
        var dataSrc = el.getAttribute('data-src');
        if(dataSrc && isExternalUrl(dataSrc)) try{ el.removeAttribute('data-src'); }catch(e){}
      }
      // 5. Remove external iframes / frames
      var iframes = clone.querySelectorAll('iframe');
      for(var i=0;i<iframes.length;i++){
        var fSrc = iframes[i].getAttribute('src') || '';
        if(isExternalUrl(fSrc)){
          var ph = document.createElement('div');
          ph.setAttribute('style','width:100%;height:160px;background:#f3f4f6;border:1px solid #e5e7eb;display:grid;place-items:center;color:#6b7280;font:12px system-ui;');
          ph.textContent='[external frame]';
          try{ iframes[i].parentNode.replaceChild(ph, iframes[i]); }catch(e){}
        }
      }
      var videos = clone.querySelectorAll('video');
      for(var i=0;i<videos.length;i++){
        var vSrc = videos[i].getAttribute('src') || '';
        var vPoster = videos[i].getAttribute('poster') || '';
        if(isExternalUrl(vSrc)) try{ videos[i].removeAttribute('src'); }catch(e){}
        if(isExternalUrl(vPoster)) try{ videos[i].removeAttribute('poster'); }catch(e){}
        var vsources = videos[i].querySelectorAll('source');
        for(var j=0;j<vsources.length;j++){
          var vs = vsources[j].getAttribute('src') || '';
          if(isExternalUrl(vs)) try{ vsources[j].parentNode.removeChild(vsources[j]); }catch(e){}
        }
      }
    }catch(e){}
    // remove screenshot host styles that might interfere? keep as is
    var serializer = new XMLSerializer();
    var serialized = '';
    try{ serialized = serializer.serializeToString(clone); }catch(e){ throw new Error('serialize failed: '+e); }
    // ensure xmlns
    if(serialized.indexOf('xmlns=')===-1){
      serialized = serialized.replace('<html', '<html xmlns="http://www.w3.org/1999/xhtml"');
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'">'
            + '<foreignObject width="100%" height="100%">'
            + '<div xmlns="http://www.w3.org/1999/xhtml" style="width:'+width+'px;height:'+height+'px;overflow:hidden;background:#fff;">'
            + serialized
            + '</div></foreignObject></svg>';
    var blob = new Blob([svg], {type:'image/svg+xml;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    try{
      var img = new Image();
      img.decoding='sync';
      try{ img.crossOrigin='anonymous'; }catch(e){}
      var loaded = new Promise(function(res, rej){
        img.onload=function(){ res(true); };
        img.onerror=function(){ rej(new Error('svg image load failed')); };
        setTimeout(function(){ rej(new Error('svg image load timeout')); }, 6000);
      });
      img.src = url;
      await loaded;
      var canvas = document.createElement('canvas');
      // DPR 1 for vision token efficiency
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      if(!ctx) throw new Error('no canvas context');
      ctx.fillStyle='#ffffff';
      ctx.fillRect(0,0,width,height);
      ctx.drawImage(img,0,0,width,height);
      var dataUrl;
      try{
        dataUrl = canvas.toDataURL('image/png');
      }catch(e){
        // Tainted canvas — surface the error to trigger fallback rendering
        throw new Error('Tainted canvases may not be exported' + (e && e.message ? ': '+e.message : ''));
      }
      return dataUrl;
    } finally {
      try{ URL.revokeObjectURL(url); }catch(e){}
    }
  }
  async function handleCapture(data){
    var requestId = data.requestId;
    var width = typeof data.width==='number' ? Math.round(data.width) : document.documentElement.clientWidth || 390;
    var height = typeof data.height==='number' ? Math.round(data.height) : document.documentElement.clientHeight || 844;
    width = Math.max(320, Math.min(width, 2048));
    height = Math.max(480, Math.min(height, 2048));
    try{
      await waitForReady();
      // hide picker markers temporarily
      var pickerRoot = document.getElementById('__emty_design_picker__');
      var prevDisplay = '';
      if(pickerRoot){ prevDisplay = pickerRoot.style.display; pickerRoot.style.display='none'; }
      var dataUrl = null;
      var error = null;
      try{
        dataUrl = await captureViaForeignObject(width,height);
      }catch(e){
        error = e instanceof Error ? e.message : String(e);
        dataUrl = renderFallbackCanvas(width,height,error);
        if(!dataUrl) throw e;
      } finally {
        if(pickerRoot) pickerRoot.style.display = prevDisplay;
      }
      if(!dataUrl || dataUrl.indexOf('data:image/png;base64,')!==0){
        throw new Error('capture produced invalid data');
      }
      // If we fell back to text rendering, still report ok but with warning - parent will treat as fallback
      var isFallback = error && error.indexOf('Tainted')!==-1;
      try{ parent.postMessage({source:SOURCE, requestId:requestId, ok:true, dataUrl:dataUrl, width:width, height:height, viewport: (width>=768? (width>=1440?'desktop':'tablet'):'mobile'), fallback: !!isFallback}, '*'); }catch(e){}
    }catch(e){
      var msg = e instanceof Error ? e.message : String(e);
      var fallback = renderFallbackCanvas(width,height,msg);
      if(fallback){
        try{ parent.postMessage({source:SOURCE, requestId:requestId, ok:true, dataUrl:fallback, width:width, height:height, viewport:'mobile', fallback:true}, '*'); return;}catch(_){}
      }
      try{ parent.postMessage({source:SOURCE, requestId:requestId, ok:false, error:msg}, '*'); }catch(_){}
    }
  }
  window.addEventListener('message', function(e){
    try{
      var d=e.data;
      if(!d || d.source!==HOST_SOURCE) return;
      if(d.action==='capture') handleCapture(d);
    }catch(err){}
  });
})();<\/script>`

export function injectScreenshotBootstrap(html: string): string {
  // Insert after picker if present, else after console, else after <head>
  const pickerIdx = html.indexOf(DESIGN_PICKER_BOOTSTRAP)
  if (pickerIdx !== -1) {
    const insertAt = pickerIdx + DESIGN_PICKER_BOOTSTRAP.length
    return html.slice(0, insertAt) + DESIGN_SCREENSHOT_BOOTSTRAP + html.slice(insertAt)
  }
  const consoleIdx = html.indexOf(CONSOLE_BOOTSTRAP)
  if (consoleIdx !== -1) {
    const insertAt = consoleIdx + CONSOLE_BOOTSTRAP.length
    return html.slice(0, insertAt) + DESIGN_SCREENSHOT_BOOTSTRAP + html.slice(insertAt)
  }
  if (html.includes('emty-design-console')) {
    const markerIdx = html.indexOf('emty-design-console')
    const closeIdx = html.indexOf('</script>', markerIdx)
    if (closeIdx !== -1) {
      const insertAt = closeIdx + '</script>'.length
      return html.slice(0, insertAt) + DESIGN_SCREENSHOT_BOOTSTRAP + html.slice(insertAt)
    }
  }
  const headMatch = /<head[^>]*>/i.exec(html)
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length
    return html.slice(0, idx) + DESIGN_SCREENSHOT_BOOTSTRAP + html.slice(idx)
  }
  return DESIGN_SCREENSHOT_BOOTSTRAP + html
}
