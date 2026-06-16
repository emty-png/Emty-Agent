(() => {
  const SESSION_ID = __SESSION_ID__
  const MAIN_LABEL = __MAIN_LABEL__
  const STATE_EVENT = __STATE_EVENT__
  const BRIDGE_EVENT = __BRIDGE_EVENT__
  const INTERACTIVE_SELECTOR = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]'

  function invoke(command, args) {
    const internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function')
      return Promise.reject(new Error('Tauri IPC is unavailable in this browser page.'))

    return internals.invoke(command, args)
  }

  function emitToMain(event, payload) {
    return invoke('plugin:event|emit_to', {
      target: { kind: 'AnyLabel', label: MAIN_LABEL },
      event,
      payload: {
        sessionId: SESSION_ID,
        ...payload,
      },
    })
  }

  function installComfortStyles() {
    if (document.getElementById('__emty_agent_browser_comfort_styles__'))
      return

    const style = document.createElement('style')
    style.id = '__emty_agent_browser_comfort_styles__'
    style.textContent = `
      :root {
        scrollbar-width: thin;
        scrollbar-color: #2e2618 transparent;
      }

      * {
        scrollbar-width: thin;
        scrollbar-color: #2e2618 transparent;
      }

      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      ::-webkit-scrollbar-track {
        background: transparent;
      }

      ::-webkit-scrollbar-thumb {
        min-height: 32px;
        background: color-mix(in srgb, #2e2618 88%, transparent);
        border: 2px solid transparent;
        border-radius: 999px;
        background-clip: padding-box;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, #443a28 92%, transparent);
        background-clip: padding-box;
      }

      ::-webkit-scrollbar-corner {
        background: transparent;
      }
    `

    const target = document.head || document.documentElement
    target.appendChild(style)
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function truncate(value, max = 300) {
    const text = normalizeText(value)
    return text.length > max ? `${text.slice(0, max)}...` : text
  }

  function serializeValue(value) {
    if (value === undefined)
      return null

    try {
      return JSON.parse(JSON.stringify(value))
    }
    catch {
      return truncate(String(value), 4000)
    }
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement))
      return false

    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none'
  }

  function elementText(el) {
    return normalizeText(
      el.getAttribute('aria-label')
      || el.innerText
      || el.textContent
      || '',
    )
  }

  function elementRole(el) {
    return el.getAttribute('role') || null
  }

  function elementIdentifier(el) {
    if (el.id)
      return `#${el.id}`
    if (el.getAttribute('name'))
      return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`
    if (el.classList.length > 0)
      return `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}`
    return el.tagName.toLowerCase()
  }

  function describeElement(el) {
    const rect = el.getBoundingClientRect()
    const value = 'value' in el ? String(el.value ?? '') : ''
    const checked = 'checked' in el ? Boolean(el.checked) : undefined

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name'),
      role: elementRole(el),
      selectorHint: elementIdentifier(el),
      text: truncate(elementText(el), 220),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      placeholder: el.getAttribute('placeholder'),
      type: 'type' in el ? String(el.type ?? '') : null,
      disabled: 'disabled' in el ? Boolean(el.disabled) : false,
      checked,
      valuePreview: value ? truncate(value, 120) : null,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    }
  }

  function collectVisible(selector, maxItems, mapper) {
    return Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .slice(0, maxItems)
      .map(mapper)
  }

  function findAssociatedInput(el) {
    if (el instanceof HTMLLabelElement) {
      if (el.control)
        return el.control
      const nested = el.querySelector('input, textarea, select, [contenteditable="true"]')
      if (nested)
        return nested
    }
    return el
  }

  function textCandidates() {
    return Array.from(document.querySelectorAll(`${INTERACTIVE_SELECTOR}, label, h1, h2, h3, h4, h5, h6, p, span, div`))
      .filter(isVisible)
      .map(el => ({ el, text: elementText(el) }))
      .filter(entry => entry.text)
  }

  function resolveByText(text, index = 0) {
    const wanted = normalizeText(text).toLowerCase()
    if (!wanted)
      throw new Error('Text target is empty')

    const candidates = textCandidates()
    const exact = candidates.filter(entry => entry.text.toLowerCase() === wanted)
    const partial = candidates.filter(entry => entry.text.toLowerCase().includes(wanted))
    const matches = (exact.length > 0 ? exact : partial).map(entry => entry.el)

    if (!matches[index]) {
      const hints = partial
        .slice(0, 5)
        .map(entry => `- ${truncate(entry.text, 80)}`)
        .join('\n')

      throw new Error(hints
        ? `Could not find a visible element matching "${text}". Similar text:\n${hints}`
        : `Could not find a visible element matching "${text}".`)
    }

    return matches[index]
  }

  function resolveTarget(args) {
    const index = Number(args.index ?? 0)

    if (args.selector) {
      const matches = Array.from(document.querySelectorAll(String(args.selector))).filter(isVisible)
      if (!matches[index])
        throw new Error(`No visible element found for selector "${args.selector}"`)
      return matches[index]
    }

    if (args.text)
      return resolveByText(String(args.text), index)

    throw new Error('A selector or text target is required')
  }

  function focusTarget(el) {
    if (el instanceof HTMLElement)
      el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function waitForReady(timeoutMs = 10000) {
    installComfortStyles()

    if (document.readyState !== 'loading')
      return

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for DOM readiness after ${timeoutMs}ms`))
      }, timeoutMs)

      const cleanup = () => {
        window.clearTimeout(timeout)
        document.removeEventListener('DOMContentLoaded', onReady)
      }

      const onReady = () => {
        cleanup()
        resolve()
      }

      document.addEventListener('DOMContentLoaded', onReady, { once: true })
    })
  }

  async function snapshot(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const maxItems = Math.max(1, Math.min(Number(args.maxItems ?? 12), 40))
    const maxChars = Math.max(500, Math.min(Number(args.maxChars ?? 6000), 12000))
    const bodyText = truncate(document.body?.innerText || '', maxChars)

    return {
      title: document.title,
      url: window.location.href,
      readyState: document.readyState,
      excerpt: bodyText,
      headings: collectVisible('h1, h2, h3', maxItems, el => ({
        level: Number(el.tagName.slice(1)),
        text: truncate(elementText(el), 180),
      })),
      links: collectVisible('a[href]', maxItems, el => ({
        text: truncate(elementText(el), 140),
        href: el.href,
      })),
      buttons: collectVisible('button, [role="button"], input[type="button"], input[type="submit"]', maxItems, el => ({
        text: truncate(elementText(el) || el.getAttribute('value') || '', 140),
        disabled: 'disabled' in el ? Boolean(el.disabled) : false,
      })),
      inputs: collectVisible('input, textarea, select, [contenteditable="true"]', maxItems, el => describeElement(el)),
      activeElement: document.activeElement instanceof Element && document.activeElement !== document.body
        ? describeElement(document.activeElement)
        : null,
    }
  }

  async function extract(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const el = findAssociatedInput(resolveTarget(args))
    return {
      title: document.title,
      url: window.location.href,
      element: describeElement(el),
      text: truncate(elementText(el), Number(args.maxChars ?? 1200)),
      html: truncate(el.outerHTML || '', Number(args.maxChars ?? 1200)),
    }
  }

  async function click(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const el = resolveTarget(args)
    focusTarget(el)

    if (el instanceof HTMLElement)
      el.click()
    else
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    return {
      title: document.title,
      url: window.location.href,
      clicked: describeElement(el),
    }
  }

  async function type(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const value = String(args.value ?? '')
    const replace = args.replace !== false
    const submit = args.submit === true
    const rawTarget = resolveTarget(args)
    const el = findAssociatedInput(rawTarget)
    focusTarget(el)

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = replace ? value : `${el.value}${value}`
      dispatchInputEvents(el)
      if (submit && el.form)
        el.form.requestSubmit()
    }
    else if (el instanceof HTMLSelectElement) {
      const option = Array.from(el.options).find(opt =>
        normalizeText(opt.text).toLowerCase() === normalizeText(value).toLowerCase()
        || String(opt.value) === value,
      )

      if (!option)
        throw new Error(`No option matched "${value}"`)

      el.value = option.value
      dispatchInputEvents(el)
    }
    else if (el instanceof HTMLElement && el.isContentEditable) {
      el.textContent = replace ? value : `${el.textContent ?? ''}${value}`
      dispatchInputEvents(el)
    }
    else {
      throw new Error(`Target ${elementIdentifier(el)} does not accept text input`)
    }

    return {
      title: document.title,
      url: window.location.href,
      typedInto: describeElement(el),
    }
  }

  async function press(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const combo = String(args.key ?? '').trim()
    if (!combo)
      throw new Error('A key is required')

    const target = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body

    focusTarget(target)

    const parts = combo
      .split('+')
      .map(part => part.trim())
      .filter(Boolean)

    const key = parts.length > 0 ? parts.at(-1) : combo
    const modifiers = parts.slice(0, -1).reduce((state, part) => {
      const lower = part.toLowerCase()
      return {
        ctrlKey: state.ctrlKey || lower === 'ctrl' || lower === 'control',
        altKey: state.altKey || lower === 'alt',
        shiftKey: state.shiftKey || lower === 'shift',
        metaKey: state.metaKey || lower === 'meta' || lower === 'cmd' || lower === 'command',
      }
    }, {
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })

    const options = {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    }

    target.dispatchEvent(new KeyboardEvent('keydown', options))
    target.dispatchEvent(new KeyboardEvent('keyup', options))

    if (key === 'Enter' && target instanceof HTMLInputElement && target.form)
      target.form.requestSubmit()

    return {
      title: document.title,
      url: window.location.href,
      activeElement: target ? describeElement(target) : null,
    }
  }

  async function scroll(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    if (args.selector || args.text) {
      const el = resolveTarget(args)
      focusTarget(el)
      return {
        title: document.title,
        url: window.location.href,
        scrolledTo: describeElement(el),
      }
    }

    const direction = String(args.direction ?? 'down')
    const amount = Number(args.amount ?? window.innerHeight * 0.8)

    if (direction === 'top')
      window.scrollTo({ top: 0, behavior: 'instant' })
    else if (direction === 'bottom')
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
    else
      window.scrollBy({
        top: direction === 'up' ? -Math.abs(amount) : Math.abs(amount),
        behavior: 'instant',
      })

    return {
      title: document.title,
      url: window.location.href,
      scrollY: Math.round(window.scrollY),
    }
  }

  async function wait(args = {}) {
    const timeoutMs = Number(args.timeoutMs ?? 10000)
    const pollMs = 125
    const started = Date.now()

    while (Date.now() - started <= timeoutMs) {
      try {
        if (args.urlContains && window.location.href.includes(String(args.urlContains))) {
          return {
            title: document.title,
            url: window.location.href,
            matched: { kind: 'url', value: String(args.urlContains) },
          }
        }

        if (args.selectorAppears || args.selector) {
          const selector = String(args.selectorAppears ?? args.selector)
          const found = Array.from(document.querySelectorAll(selector)).find(isVisible)
          if (found) {
            return {
              title: document.title,
              url: window.location.href,
              matched: { kind: 'selector', value: selector },
              element: describeElement(found),
            }
          }
        }

        if (args.selectorDisappears) {
          const selector = String(args.selectorDisappears)
          const found = Array.from(document.querySelectorAll(selector)).find(isVisible)
          if (!found) {
            return {
              title: document.title,
              url: window.location.href,
              matched: { kind: 'selector-disappeared', value: selector },
            }
          }
        }

        if (args.text) {
          const found = resolveByText(String(args.text), Number(args.index ?? 0))
          if (found) {
            return {
              title: document.title,
              url: window.location.href,
              matched: { kind: 'text', value: String(args.text) },
              element: describeElement(found),
            }
          }
        }
      }
      catch {
      }

      await new Promise(resolve => window.setTimeout(resolve, pollMs))
    }

    throw new Error(`Condition was not met within ${timeoutMs}ms`)
  }

  async function history(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const direction = String(args.direction ?? 'back')

    window.setTimeout(() => {
      if (direction === 'forward')
        window.history.forward()
      else
        window.history.back()
    }, 0)

    return {
      title: document.title,
      url: window.location.href,
      direction,
      triggered: true,
    }
  }

  async function execute(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const script = String(args.script ?? '').trim()
    if (!script)
      throw new Error('A script is required')

    const runner = new Function(`
      return (async () => {
        ${script}
      })()
    `)

    const value = await runner.call(window)

    return {
      title: document.title,
      url: window.location.href,
      value: serializeValue(value),
    }
  }

  function ensureCurrentOrigin(targetUrl) {
    if (!targetUrl)
      return

    const parsed = new URL(String(targetUrl), window.location.href)
    if (parsed.origin !== window.location.origin)
      throw new Error('browser_cookies currently supports only the active page origin.')
  }

  function readDocumentCookies() {
    if (!document.cookie)
      return []

    return document.cookie
      .split(';')
      .map(chunk => chunk.trim())
      .filter(Boolean)
      .map(chunk => {
        const separatorIndex = chunk.indexOf('=')
        const name = separatorIndex === -1 ? chunk : chunk.slice(0, separatorIndex)
        const value = separatorIndex === -1 ? '' : chunk.slice(separatorIndex + 1)

        return {
          name: decodeURIComponent(name),
          value: decodeURIComponent(value),
          domain: window.location.hostname,
          path: '/',
          secure: window.location.protocol === 'https:',
          httpOnly: false,
        }
      })
  }

  function writeCookie(cookie) {
    const parts = [
      `${encodeURIComponent(String(cookie.name ?? ''))}=${encodeURIComponent(String(cookie.value ?? ''))}`,
      `path=${cookie.path || '/'}`,
    ]

    if (cookie.domain)
      parts.push(`domain=${cookie.domain}`)
    if (typeof cookie.expires === 'number')
      parts.push(`expires=${new Date(cookie.expires * 1000).toUTCString()}`)
    if (cookie.secure)
      parts.push('secure')
    if (cookie.sameSite)
      parts.push(`samesite=${cookie.sameSite}`)

    document.cookie = parts.join('; ')
  }

  async function cookies(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const action = String(args.action ?? 'get')
    ensureCurrentOrigin(args.url)

    if (action === 'get') {
      return {
        title: document.title,
        url: window.location.href,
        cookies: readDocumentCookies(),
      }
    }

    if (action === 'set') {
      const cookie = args.cookie
      if (!cookie || !cookie.name)
        throw new Error('browser_cookies action="set" requires a cookie object with a name.')

      writeCookie(cookie)
      return {
        title: document.title,
        url: window.location.href,
        ok: true,
        cookies: readDocumentCookies(),
      }
    }

    if (action === 'delete') {
      const currentCookies = readDocumentCookies()
      const names = args.name
        ? [String(args.name)]
        : currentCookies.map(cookie => cookie.name)

      for (const name of names) {
        writeCookie({
          name,
          value: '',
          path: '/',
          expires: 0,
        })
      }

      return {
        title: document.title,
        url: window.location.href,
        ok: true,
        deleted: names,
        cookies: readDocumentCookies(),
      }
    }

    throw new Error(`Unsupported cookie action "${action}"`)
  }

  async function screenshot(args = {}) {
    await waitForReady(Number(args.timeoutMs ?? 10000))

    const pixelRatio = Math.max(1, Math.min(Number(window.devicePixelRatio || 1), 2))
    const width = Math.max(document.documentElement.clientWidth, window.innerWidth)
    const height = Math.max(document.documentElement.clientHeight, window.innerHeight)
    const fallbackWidth = Math.min(Math.max(width, 960), 1600)
    const fallbackHeight = Math.min(Math.max(height, 720), 1200)

    function drawWrappedText(context, text, x, startY, maxWidth, lineHeight, maxLines) {
      const words = String(text || '').split(/\s+/).filter(Boolean)
      const lines = []
      let currentLine = ''

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word
        if (context.measureText(candidate).width <= maxWidth) {
          currentLine = candidate
          continue
        }

        if (currentLine)
          lines.push(currentLine)

        currentLine = word
        if (lines.length >= maxLines - 1)
          break
      }

      if (currentLine && lines.length < maxLines)
        lines.push(currentLine)

      lines.forEach((line, index) => {
        context.fillText(line, x, startY + index * lineHeight)
      })

      return lines.length
    }

    function renderFallbackScreenshot(reason) {
      const canvas = document.createElement('canvas')
      canvas.width = fallbackWidth
      canvas.height = fallbackHeight

      const context = canvas.getContext('2d')
      if (!context)
        throw new Error('Canvas rendering is unavailable for screenshots.')

      const excerpt = truncate(document.body?.innerText || 'No visible page text was available.', 1800)

      context.fillStyle = '#f5f7fb'
      context.fillRect(0, 0, canvas.width, canvas.height)

      context.fillStyle = '#ffffff'
      context.strokeStyle = '#d7deea'
      context.lineWidth = 1
      context.fillRect(32, 32, canvas.width - 64, canvas.height - 64)
      context.strokeRect(32.5, 32.5, canvas.width - 65, canvas.height - 65)

      context.fillStyle = '#111827'
      context.font = '600 24px sans-serif'
      context.fillText('Screenshot fallback', 64, 84)

      context.fillStyle = '#4b5563'
      context.font = '14px sans-serif'
      context.fillText(`Title: ${truncate(document.title || 'Untitled page', 100)}`, 64, 122)
      context.fillText(`URL: ${truncate(window.location.href, 120)}`, 64, 146)
      context.fillText(`Reason: ${truncate(reason || 'Unable to render live preview.', 140)}`, 64, 170)

      context.fillStyle = '#e5e7eb'
      context.fillRect(64, 198, canvas.width - 128, canvas.height - 262)

      context.fillStyle = '#1f2937'
      context.font = '600 16px sans-serif'
      context.fillText('Visible page text', 84, 228)

      context.fillStyle = '#374151'
      context.font = '14px sans-serif'
      drawWrappedText(
        context,
        excerpt,
        84,
        258,
        canvas.width - 168,
        24,
        Math.max(8, Math.floor((canvas.height - 310) / 24)),
      )

      return canvas.toDataURL('image/png')
    }

    const clone = document.documentElement.cloneNode(true)
    clone.querySelectorAll('script').forEach(node => node.remove())

    const serializer = new XMLSerializer()
    let source = serializer.serializeToString(clone)

    if (!source.includes('<base '))
      source = source.replace('<head>', `<head><base href="${window.location.href}">`)
    if (!source.includes('xmlns="http://www.w3.org/1999/xhtml"'))
      source = source.replace('<html', '<html xmlns="http://www.w3.org/1999/xhtml"')

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject width="100%" height="100%">${source}</foreignObject>
      </svg>
    `

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Failed to render a screenshot preview for this page.'))
        img.src = objectUrl
      })

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)

      const context = canvas.getContext('2d')
      if (!context)
        throw new Error('Canvas rendering is unavailable for screenshots.')

      context.scale(pixelRatio, pixelRatio)
      context.drawImage(image, 0, 0, width, height)

      return {
        title: document.title,
        url: window.location.href,
        dataUrl: canvas.toDataURL('image/png'),
        width,
        height,
      }
    }
    catch (error) {
      return {
        title: document.title,
        url: window.location.href,
        dataUrl: renderFallbackScreenshot(error?.message || String(error)),
        width: fallbackWidth,
        height: fallbackHeight,
        fallback: true,
        warning: truncate(error?.message || String(error), 200),
      }
    }
    finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  async function dispatch(request) {
    const action = String(request.action || '')
    const args = request.args || {}

    switch (action) {
      case 'snapshot':
        return snapshot(args)
      case 'extract':
        return extract(args)
      case 'click':
        return click(args)
      case 'type':
        return type(args)
      case 'press':
        return press(args)
      case 'scroll':
        return scroll(args)
      case 'wait':
        return wait(args)
      case 'history':
        return history(args)
      case 'execute':
        return execute(args)
      case 'cookies':
        return cookies(args)
      case 'screenshot':
        return screenshot(args)
      default:
        throw new Error(`Unsupported browser bridge action "${action}"`)
    }
  }

  window.__EMTY_AGENT_BROWSER_BRIDGE__ = {
    run(request) {
      return dispatch(request)
    },

    dispatch(request) {
      Promise.resolve()
        .then(() => dispatch(request))
        .then(result => emitToMain(BRIDGE_EVENT, {
          requestId: request.id,
          ok: true,
          result,
        }))
        .catch(error => emitToMain(BRIDGE_EVENT, {
          requestId: request.id,
          ok: false,
          error: truncate(error?.message || String(error), 400),
        }))
    },
  }

  installComfortStyles()

  emitToMain(STATE_EVENT, {
    kind: 'bridge-ready',
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
  }).catch(() => {})
})()
