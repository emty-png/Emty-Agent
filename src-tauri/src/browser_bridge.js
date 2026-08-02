(() => {
  const SESSION_ID = __SESSION_ID__
  const MAIN_LABEL = __MAIN_LABEL__
  const STATE_EVENT = __STATE_EVENT__
  const BRIDGE_EVENT = __BRIDGE_EVENT__
  const ELEMENT_PICK_EVENT = 'browser://element-picked'
  const INTERACTIVE_SELECTOR = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]'
  const PICKER_ROOT_ID = '__emty_agent_browser_picker__'
  const PICKER_STYLE_ID = '__emty_agent_browser_picker_styles__'

  if (!window.__EMTY_AGENT_LOGS__) {
    window.__EMTY_AGENT_LOGS__ = []
    const methods = ['log', 'info', 'warn', 'error', 'debug']
    for (const method of methods) {
      const original = console[method]
      console[method] = function (...args) {
        try {
          const message = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
              try {
                return JSON.stringify(arg)
              }
              catch {
                return String(arg)
              }
            }
            return String(arg)
          }).join(' ')
          
          window.__EMTY_AGENT_LOGS__.push(`[${method.toUpperCase()}] ${message}`)
          if (window.__EMTY_AGENT_LOGS__.length > 500) {
            window.__EMTY_AGENT_LOGS__.shift()
          }
        }
        catch (e) {
          // Ignore serialization errors in interceptor
        }
        if (original) original.apply(console, args)
      }
    }
  }

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

  function truncateRaw(value, max = 4000) {
    const text = String(value ?? '')
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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function')
      return window.CSS.escape(String(value))
    return String(value).replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`)
  }

  function selectorForElement(el) {
    if (!(el instanceof Element))
      return ''

    if (el.id)
      return `#${cssEscape(el.id)}`

    const parts = []
    let current = el
    while (current && current instanceof Element && current !== document.documentElement) {
      let part = current.tagName.toLowerCase()
      const parent = current.parentElement
      if (!parent)
        break

      const sameTagSiblings = Array.from(parent.children)
        .filter(child => child.tagName === current.tagName)
      if (sameTagSiblings.length > 1)
        part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`

      parts.unshift(part)
      if (parts.length >= 6)
        break
      current = parent
    }

    return parts.join(' > ') || elementIdentifier(el)
  }

  function elementAttributes(el) {
    const attrs = {}
    for (const attr of Array.from(el.attributes || [])) {
      attrs[attr.name] = truncateRaw(attr.value, 300)
    }
    return attrs
  }

  function describeElement(el, options = {}) {
    const rect = el.getBoundingClientRect()
    const value = 'value' in el ? String(el.value ?? '') : ''
    const checked = 'checked' in el ? Boolean(el.checked) : undefined
    const maxHtmlChars = Number(options.maxHtmlChars ?? 4000)

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList],
      name: el.getAttribute('name'),
      role: elementRole(el),
      ariaLabel: el.getAttribute('aria-label'),
      selector: selectorForElement(el),
      selectorHint: elementIdentifier(el),
      text: truncate(elementText(el), 220),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      attributes: elementAttributes(el),
      outerHTML: truncateRaw(el.outerHTML || '', maxHtmlChars),
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

  const pickerState = {
    active: false,
    hovered: null,
    selected: null,
    root: null,
    hoverBox: null,
    markerLayer: null,
    composer: null,
    annotations: [],
    raf: 0,
    markerListenersActive: false,
  }

  function installPickerStyles() {
    if (document.getElementById(PICKER_STYLE_ID))
      return

    const style = document.createElement('style')
    style.id = PICKER_STYLE_ID
    style.textContent = `
      #${PICKER_ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f8fbff;
      }

      #${PICKER_ROOT_ID} * {
        box-sizing: border-box;
      }

      .emty-picker-hover,
      .emty-picker-marker-box {
        position: fixed;
        border: 2px solid #178cff;
        background: rgba(23, 140, 255, 0.16);
        box-shadow: 0 0 0 1px rgba(255,255,255,0.76), 0 10px 32px rgba(0,0,0,0.18);
        pointer-events: none;
      }

      .emty-picker-hover {
        display: none;
      }

      .emty-picker-pin,
      .emty-picker-marker-pin {
        position: fixed;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 2px solid #ffffff;
        border-radius: 999px;
        background: #178cff;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        pointer-events: none;
      }

      .emty-picker-pin::before,
      .emty-picker-marker-pin::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #ffffff;
      }

      .emty-picker-composer {
        position: fixed;
        width: min(300px, calc(100vw - 24px));
        border: 1px solid #262626;
        border-radius: 12px;
        background: #0a0a0a;
        box-shadow: 0 12px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3);
        padding: 6px;
        pointer-events: auto;
      }

      .emty-picker-composer-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .emty-picker-comment {
        flex: 1;
        min-width: 0;
        height: 28px;
        box-sizing: border-box;
        border: 1px solid #333333;
        border-radius: 8px;
        outline: 0;
        resize: none;
        background: #141414;
        color: #f2f2f2;
        font: inherit;
        font-size: 12px;
        line-height: 20px;
        padding: 4px 8px;
        transition: border-color 150ms ease;
      }

      .emty-picker-comment:focus {
        border-color: #00e5ff;
      }

      .emty-picker-comment::placeholder {
        color: #595959;
      }

      .emty-picker-action,
      .emty-picker-cancel {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border: 1px solid #333333;
        border-radius: 8px;
        background: #141414;
        color: #8a8a8a;
        cursor: pointer;
        font: inherit;
        transition: background 100ms cubic-bezier(0.4,0,0.2,1), border-color 100ms cubic-bezier(0.4,0,0.2,1), color 100ms cubic-bezier(0.4,0,0.2,1);
      }

      .emty-picker-cancel:hover {
        background: #1c1c1c;
        color: #f2f2f2;
      }

      .emty-picker-cancel:active {
        transform: scale(0.97);
      }

      .emty-picker-action:disabled {
        cursor: default;
        opacity: 0.45;
      }

      .emty-picker-action:not(:disabled) {
        border-color: rgba(0,229,255,0.4);
        background: rgba(0,229,255,0.18);
        color: #00e5ff;
      }

      .emty-picker-action:not(:disabled):hover {
        background: rgba(0,229,255,0.28);
      }

      .emty-picker-action:not(:disabled):active {
        transform: scale(0.97);
      }

      .emty-picker-marker-note {
        position: fixed;
        max-width: 260px;
        padding: 7px 10px;
        border-radius: 12px;
        background: #178cff;
        color: #ffffff;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.35;
        box-shadow: 0 8px 22px rgba(0,0,0,0.25);
        pointer-events: none;
      }
    `

    const target = document.head || document.documentElement
    target.appendChild(style)
  }

  function ensurePickerRoot() {
    installPickerStyles()

    if (pickerState.root && document.documentElement.contains(pickerState.root))
      return pickerState.root

    const root = document.createElement('div')
    root.id = PICKER_ROOT_ID

    const hoverBox = document.createElement('div')
    hoverBox.className = 'emty-picker-hover'
    const pin = document.createElement('div')
    pin.className = 'emty-picker-pin'
    hoverBox.appendChild(pin)

    const markerLayer = document.createElement('div')
    markerLayer.className = 'emty-picker-marker-layer'

    root.appendChild(markerLayer)
    root.appendChild(hoverBox)
    document.documentElement.appendChild(root)

    pickerState.root = root
    pickerState.hoverBox = hoverBox
    pickerState.markerLayer = markerLayer
    return root
  }

  function isPickerElement(node) {
    return node instanceof Element && !!node.closest(`#${PICKER_ROOT_ID}`)
  }

  function elementFromPointer(event) {
    const el = document.elementFromPoint(event.clientX, event.clientY)
    if (!el || isPickerElement(el) || el === document.documentElement || el === document.body)
      return null
    return el
  }

  function getPageZoomScale() {
    // CSS zoom on <html> scales getBoundingClientRect() values but NOT
    // position:fixed coordinates. Divide by the zoom factor to compensate.
    const zoom = window.__EMTY_AGENT_BROWSER_ZOOM__ ?? 100
    return zoom / 100
  }

  function toViewport(value) {
    return value / getPageZoomScale()
  }

  function positionBox(box, rect) {
    const scale = getPageZoomScale()
    const left = rect.left / scale
    const top = rect.top / scale
    const width = rect.width / scale
    const height = rect.height / scale
    const right = rect.right / scale

    box.style.display = 'block'
    box.style.left = `${Math.max(0, Math.round(left))}px`
    box.style.top = `${Math.max(0, Math.round(top))}px`
    box.style.width = `${Math.max(1, Math.round(width))}px`
    box.style.height = `${Math.max(1, Math.round(height))}px`

    const pin = box.querySelector('.emty-picker-pin, .emty-picker-marker-pin')
    if (pin) {
      pin.style.left = `${Math.min(window.innerWidth - 26, Math.max(4, Math.round(right - 12)))}px`
      pin.style.top = `${Math.min(window.innerHeight - 26, Math.max(4, Math.round(top + height / 2 - 11)))}px`
    }
  }

  function updateHoverBox() {
    if (!pickerState.hoverBox || !pickerState.hovered)
      return
    positionBox(pickerState.hoverBox, pickerState.hovered.getBoundingClientRect())
  }

  function hideHoverBox() {
    if (pickerState.hoverBox)
      pickerState.hoverBox.style.display = 'none'
  }

  function scheduleMarkerRender() {
    if (pickerState.raf)
      return
    pickerState.raf = window.requestAnimationFrame(() => {
      pickerState.raf = 0
      renderPickerMarkers()
      updateHoverBox()
    })
  }

  function syncMarkerListeners() {
    const shouldListen = pickerState.active || pickerState.annotations.length > 0
    if (shouldListen === pickerState.markerListenersActive)
      return

    pickerState.markerListenersActive = shouldListen
    const method = shouldListen ? 'addEventListener' : 'removeEventListener'
    window[method]('scroll', scheduleMarkerRender, true)
    window[method]('resize', scheduleMarkerRender, true)
  }

  function renderPickerMarkers() {
    ensurePickerRoot()
    const layer = pickerState.markerLayer
    if (!layer)
      return

    layer.textContent = ''
    for (const annotation of pickerState.annotations) {
      if (!annotation?.element?.selector)
        continue
      let el = null
      try {
        el = document.querySelector(annotation.element.selector)
      }
      catch {
        el = null
      }
      if (!el || !isVisible(el))
        continue

      const rect = el.getBoundingClientRect()
      const box = document.createElement('div')
      box.className = 'emty-picker-marker-box'
      const pin = document.createElement('div')
      pin.className = 'emty-picker-marker-pin'
      box.appendChild(pin)
      positionBox(box, rect)

      const note = document.createElement('div')
      note.className = 'emty-picker-marker-note'
      note.textContent = truncate(annotation.comment, 90)
      const scale = getPageZoomScale()
      note.style.left = `${Math.min(window.innerWidth - 272, Math.max(8, Math.round(rect.left / scale)))}px`
      note.style.top = `${Math.min(window.innerHeight - 48, Math.max(8, Math.round(rect.bottom / scale + 8)))}px`

      layer.appendChild(box)
      layer.appendChild(note)
    }
  }

  function removeComposer() {
    if (pickerState.composer) {
      pickerState.composer.remove()
      pickerState.composer = null
    }
    pickerState.selected = null
  }

  function showComposerFor(el) {
    ensurePickerRoot()
    removeComposer()

    pickerState.selected = el
    const rect = el.getBoundingClientRect()
    const composer = document.createElement('div')
    composer.className = 'emty-picker-composer'
    composer.innerHTML = `
      <div class="emty-picker-composer-row">
        <button class="emty-picker-cancel" type="button" aria-label="Cancel annotation">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <textarea class="emty-picker-comment" rows="1" placeholder="Add a comment..."></textarea>
        <button class="emty-picker-action" type="button" aria-label="Attach comment" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        </button>
      </div>
    `

    const scale = getPageZoomScale()
    const scaledLeft = rect.left / scale
    const scaledTop = rect.top / scale
    const scaledBottom = rect.bottom / scale
    const scaledWidth = rect.width / scale
    const left = Math.min(window.innerWidth - 332, Math.max(12, scaledLeft + scaledWidth / 2 - 160))
    const below = scaledBottom + 10
    const top = below + 58 < window.innerHeight
      ? below
      : Math.max(12, scaledTop - 58)
    composer.style.left = `${left}px`
    composer.style.top = `${top}px`

    const textarea = composer.querySelector('.emty-picker-comment')
    const action = composer.querySelector('.emty-picker-action')
    const cancel = composer.querySelector('.emty-picker-cancel')

    textarea.addEventListener('input', () => {
      action.disabled = textarea.value.trim().length === 0
    })

    textarea.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        removeComposer()
      }
      if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        submitPickerComment(textarea.value)
      }
    })

    action.addEventListener('click', () => submitPickerComment(textarea.value))
    cancel.addEventListener('click', removeComposer)

    pickerState.root.appendChild(composer)
    pickerState.composer = composer
    window.setTimeout(() => textarea.focus(), 0)
  }

  function makePickerId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function')
      return window.crypto.randomUUID()
    return `browser-element-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function submitPickerComment(rawComment) {
    const comment = normalizeText(rawComment)
    const el = pickerState.selected
    if (!comment || !el)
      return

    const annotation = {
      id: makePickerId(),
      comment,
      url: window.location.href,
      title: document.title,
      createdAt: Date.now(),
      element: describeElement(el, { maxHtmlChars: 6000 }),
    }

    pickerState.annotations.push(annotation)
    removeComposer()
    renderPickerMarkers()
    emitToMain(ELEMENT_PICK_EVENT, { annotation }).catch(() => {})
  }

  function onPickerPointerMove(event) {
    if (!pickerState.active || pickerState.composer)
      return
    const el = elementFromPointer(event)
    if (el === pickerState.hovered)
      return
    pickerState.hovered = el
    if (!el) {
      hideHoverBox()
      return
    }
    updateHoverBox()
  }

  function onPickerPointerDown(event) {
    if (!pickerState.active)
      return
    if (isPickerElement(event.target))
      return
    const el = elementFromPointer(event)
    if (!el)
      return
    event.preventDefault()
    event.stopPropagation()
    showComposerFor(el)
  }

  function onPickerClick(event) {
    if (!pickerState.active || isPickerElement(event.target))
      return
    event.preventDefault()
    event.stopPropagation()
  }

  function onPickerKeydown(event) {
    if (!pickerState.active)
      return
    if (event.key === 'Escape') {
      event.preventDefault()
      stopElementPicker()
    }
  }

  async function startElementPicker() {
    await waitForReady()
    ensurePickerRoot()
    if (pickerState.active)
      return { active: true }

    pickerState.active = true
    document.addEventListener('pointermove', onPickerPointerMove, true)
    document.addEventListener('pointerdown', onPickerPointerDown, true)
    document.addEventListener('click', onPickerClick, true)
    document.addEventListener('keydown', onPickerKeydown, true)
    syncMarkerListeners()
    renderPickerMarkers()
    return { active: true }
  }

  function stopElementPicker() {
    if (!pickerState.active)
      return { active: false }

    pickerState.active = false
    pickerState.hovered = null
    document.removeEventListener('pointermove', onPickerPointerMove, true)
    document.removeEventListener('pointerdown', onPickerPointerDown, true)
    document.removeEventListener('click', onPickerClick, true)
    document.removeEventListener('keydown', onPickerKeydown, true)
    removeComposer()
    hideHoverBox()
    syncMarkerListeners()
    return { active: false }
  }

  async function setElementAnnotations(args = {}) {
    await waitForReady()
    ensurePickerRoot()
    pickerState.annotations = Array.isArray(args.annotations) ? args.annotations : []
    renderPickerMarkers()
    syncMarkerListeners()
    return { count: pickerState.annotations.length }
  }

  async function setPageZoom(args = {}) {
    await waitForReady()
    const zoomPercent = Math.max(25, Math.min(Number(args.zoomPercent ?? 100), 200))
    document.documentElement.style.zoom = `${zoomPercent}%`
    window.__EMTY_AGENT_BROWSER_ZOOM__ = zoomPercent
    return {
      title: document.title,
      url: window.location.href,
      zoomPercent,
    }
  }

  async function printPage() {
    await waitForReady()
    window.print()
    return {
      title: document.title,
      url: window.location.href,
      ok: true,
    }
  }

  async function findText(args = {}) {
    await waitForReady()
    const query = String(args.query ?? '').trim()
    if (!query)
      return { found: false }

    const backwards = args.backwards === true
    const found = typeof window.find === 'function'
      ? window.find(query, false, backwards, true, false, false, false)
      : false
    return {
      title: document.title,
      url: window.location.href,
      query,
      found,
    }
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
      case 'startPicker':
        return startElementPicker(args)
      case 'stopPicker':
        return stopElementPicker(args)
      case 'setAnnotations':
        return setElementAnnotations(args)
      case 'setZoom':
        return setPageZoom(args)
      case 'print':
        return printPage(args)
      case 'findText':
        return findText(args)
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