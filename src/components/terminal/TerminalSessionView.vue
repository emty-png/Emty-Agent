<script setup lang="ts">
import type { ITheme } from '@xterm/xterm'
import type { TerminalSessionState } from '@/stores/terminal'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import { resizeTerminalSession } from '@/utils/terminal'

import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  session: TerminalSessionState
  active: boolean
}>()

const terminalStore = useTerminalStore()

// hostRef is typed as HTMLElement but assigned via template ref below
let hostEl: HTMLElement | null = null

let xterm: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let dataDisposable: { dispose: () => void } | null = null
let unsubscribeOutput: (() => void) | null = null
let resizeTimeout: number | null = null
let lastSizeKey = ''
let disposed = false

// Read a CSS custom property from :root, with a hard-coded fallback.
// This avoids the trap of reading from an element that has no explicit
// background-color (which returns the truthy string 'rgba(0,0,0,0)').
function getRootVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function buildTerminalTheme(): ITheme {
  const bg = getRootVar('--color-bg-base', '#1a1a1a')
  const fg = getRootVar('--color-text-primary', '#e5e5e5')

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    selectionInactiveBackground: 'rgba(255, 255, 255, 0.08)',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  }
}

function applyTheme() {
  if (!xterm)
    return
  xterm.options.theme = buildTerminalTheme()
}

async function fitTerminal() {
  if (disposed || !xterm || !fitAddon || !hostEl || !props.active)
    return

  if (hostEl.clientWidth < 10 || hostEl.clientHeight < 10)
    return

  try {
    fitAddon.fit()
    const cols = Math.max(2, xterm.cols)
    const rows = Math.max(1, xterm.rows)
    const nextSizeKey = `${cols}x${rows}`

    if (nextSizeKey === lastSizeKey)
      return

    lastSizeKey = nextSizeKey
    await resizeTerminalSession({
      sessionId: props.session.id,
      cols,
      rows,
    })
  }
  catch (err) {
    console.warn('[Terminal] fit call bypassed: element not ready', err)
  }
}

function updateInputState() {
  if (!xterm)
    return
  xterm.options.disableStdin
    = props.session.status === 'closed' || props.session.status === 'error'
}

function focusTerminal() {
  hostEl?.focus()
  xterm?.focus()
}

// Exported so the template can bind it as the element ref
function setHostEl(el: HTMLElement | null) {
  hostEl = el
}

onMounted(() => {
  disposed = false

  xterm = new Terminal({
    // PTY already converts \n → \r\n; setting convertEol here causes double
    // conversion (\r\r\n), so leave it off.
    convertEol: false,
    cursorBlink: true,
    fontSize: 13,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    // allowTransparency must match whether we supply a transparent bg.
    // We now always supply a solid colour from :root vars, so keep it false.
    allowTransparency: false,
    theme: buildTerminalTheme(),
    scrollback: 5000,
  })

  xterm.onSelectionChange(() => {
    const selection = xterm?.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {})
    }
  })

  fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.open(hostEl!)

  dataDisposable = xterm.onData(data => {
    void terminalStore.writeToSession(props.session.id, data).catch(() => {})
  })

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimeout)
      clearTimeout(resizeTimeout)
    resizeTimeout = window.setTimeout(() => {
      void fitTerminal()
    }, 100)
  })
  resizeObserver.observe(hostEl!)

  themeObserver = new MutationObserver(() => {
    applyTheme()
    void fitTerminal()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style'],
  })

  void initTerminal()
})

async function initTerminal() {
  if (disposed || !xterm || !fitAddon || !hostEl)
    return

  // Fit xterm to the container first.
  if (hostEl.clientWidth >= 10 && hostEl.clientHeight >= 10) {
    try {
      fitAddon.fit()
      lastSizeKey = `${xterm.cols}x${xterm.rows}`

      // Await the PTY resize so it has the correct dimensions before any
      // output flows.  Without this, the shell starts writing at the default
      // 120×28 size and early output wraps at the wrong width.
      await resizeTerminalSession({
        sessionId: props.session.id,
        cols: Math.max(2, xterm.cols),
        rows: Math.max(1, xterm.rows),
      })
    }
    catch {
      // Container not laid out yet — the ResizeObserver will retry.
    }
  }

  if (disposed)
    return

  updateInputState()

  // Capture the buffer *before* subscribing so we can write it once in the
  // right order: buffer-snapshot → subscriber handles everything arriving
  // after this point.  This avoids double-writing chunks that land between
  // subscribing and the snapshot write.
  const initialBuffer = props.session.buffer

  unsubscribeOutput = terminalStore.subscribeToOutput(props.session.id, data => {
    xterm?.write(data)
  })

  // Write the buffered history that arrived before this component mounted.
  if (initialBuffer) {
    xterm.write(initialBuffer)
  }

  nextTick().then(() => {
    applyTheme()
    requestAnimationFrame(() => {
      void fitTerminal()
      if (props.active)
        focusTerminal()
    })
  })
}

watch(
  () => props.session.status,
  () => {
    updateInputState()
  },
)

watch(
  () => props.active,
  async active => {
    if (!xterm)
      return
    if (active) {
      await nextTick()
      applyTheme()
      void fitTerminal()
      focusTerminal()
    }
  },
)

onUnmounted(() => {
  disposed = true
  if (resizeTimeout) {
    clearTimeout(resizeTimeout)
    resizeTimeout = null
  }
  unsubscribeOutput?.()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  dataDisposable?.dispose()
  xterm?.dispose()

  unsubscribeOutput = null
  dataDisposable = null
  resizeObserver = null
  themeObserver = null
  fitAddon = null
  xterm = null
  hostEl = null
})
</script>

<template>
  <div class="relative w-full h-full bg-[var(--color-bg-base,#1a1a1a)] overflow-hidden pt-3 px-4 pb-4">
    <div
      :ref="(el) => setHostEl(el as HTMLElement | null)"
      class="w-full h-full overflow-hidden outline-none bg-transparent text-[var(--color-text-primary,#e5e5e5)]"
      tabindex="0"
      @mousedown="focusTerminal"
    />
  </div>
</template>
