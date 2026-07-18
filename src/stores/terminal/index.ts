import type { UnlistenFn } from '@tauri-apps/api/event'
import type { TerminalEvent } from '@/utils/terminal'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { makeId } from '@/stores/chat/utils'
import { closeTerminalSession, listenToTerminalEvents, startTerminalSession, writeTerminalSession } from '@/utils/terminal'

export type TerminalSessionStatus = 'starting' | 'ready' | 'closed' | 'error'

export interface TerminalSessionState {
  id: string
  title: string
  cwd: string | null
  shell: string
  status: TerminalSessionStatus
  exitCode: number | null
  error: string
  buffer: string
  hasReceivedOutput: boolean
  debugSteps: string[]
  createdAt: number
  updatedAt: number
}

export type TerminalOwnerPosition = 'bottom' | 'right'

export interface TerminalOwnerState {
  isPanelOpen: boolean
  heightPercent: number
  position: TerminalOwnerPosition
  splitPercent: number
  sessions: TerminalSessionState[]
  activeSessionId: string | null
}

const DEFAULT_HEIGHT_PERCENT = 28
const MIN_HEIGHT_PERCENT = 18
const MAX_HEIGHT_PERCENT = 50
const DEFAULT_SPLIT_PERCENT = 50
const MAX_BUFFER_CHARS = 200_000
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 28

let terminalEventsBound = false
let terminalEventsUnlisten: UnlistenFn | null = null

const outputSubscribers = new Map<string, Set<(data: string) => void>>()

function now() {
  return Date.now()
}

function createOwnerState(): TerminalOwnerState {
  return {
    isPanelOpen: false,
    heightPercent: DEFAULT_HEIGHT_PERCENT,
    position: 'bottom',
    splitPercent: DEFAULT_SPLIT_PERCENT,
    sessions: [],
    activeSessionId: null,
  }
}

function trimTerminalBuffer(buffer: string) {
  if (buffer.length <= MAX_BUFFER_CHARS)
    return buffer

  return buffer.slice(-MAX_BUFFER_CHARS)
}

function appendTerminalText(session: TerminalSessionState, text: string) {
  session.buffer = trimTerminalBuffer(`${session.buffer}${text}`)
  session.updatedAt = now()
}

function appendDebug(session: TerminalSessionState, message: string) {
  session.debugSteps.push(message)
  if (session.debugSteps.length > 20)
    session.debugSteps.shift()
}

function appendSystemLine(session: TerminalSessionState, message: string) {
  appendTerminalText(session, `${message}\r\n`)
}

function titleFromShell(shell: string, cwd: string | null) {
  const folderName = cwd?.replace(/[\\/]+$/, '').split(/[/\\]/).pop()
  if (folderName)
    return folderName
  if (/^pwsh(?:\.exe)?$/i.test(shell) || /^powershell(?:\.exe)?$/i.test(shell))
    return 'PowerShell'
  return shell || 'Terminal'
}

function notifyOutputSubscribers(sessionId: string, data: string) {
  const subs = outputSubscribers.get(sessionId)
  if (!subs || subs.size === 0)
    return
  for (const cb of subs)
    cb(data)
}

export const useTerminalStore = defineStore('terminal', () => {
  const owners = ref<Record<string, TerminalOwnerState>>({})

  function ensureOwner(ownerId: string): TerminalOwnerState {
    owners.value[ownerId] ??= createOwnerState()
    return owners.value[ownerId]!
  }

  function getOwner(ownerId: string): TerminalOwnerState {
    return ensureOwner(ownerId)
  }

  function findSession(
    sessionId: string,
  ): { ownerId: string; owner: TerminalOwnerState; session: TerminalSessionState; index: number } | null {
    for (const [ownerId, owner] of Object.entries(owners.value)) {
      const index = owner.sessions.findIndex(session => session.id === sessionId)
      if (index >= 0) {
        return {
          ownerId,
          owner,
          session: owner.sessions[index]!,
          index,
        }
      }
    }

    return null
  }

  async function ensureTerminalEvents() {
    if (terminalEventsBound)
      return

    terminalEventsUnlisten = await listenToTerminalEvents(event => {
      handleTerminalEvent(event)
    })
    terminalEventsBound = true
  }

  function handleTerminalEvent(event: TerminalEvent) {
    const match = findSession(event.sessionId)
    if (!match) {
      try {
        console.warn('[TerminalStore] session not found for event', event.sessionId, event)
      }
      catch {}
      return
    }

    match.session.updatedAt = now()

    switch (event.type) {
      case 'started':
        match.session.shell = event.shell
        match.session.cwd = event.cwd
        match.session.title = titleFromShell(event.shell, event.cwd)
        match.session.status = 'ready'
        match.session.error = ''
        appendDebug(match.session, `started shell=${event.shell || '<empty>'} cwd=${event.cwd}`)
        break

      case 'output': {
        const data = event.data
        if (!data)
          break

        match.session.hasReceivedOutput = true
        match.session.buffer = trimTerminalBuffer(match.session.buffer + data)
        if (match.session.status === 'starting')
          match.session.status = 'ready'

        notifyOutputSubscribers(event.sessionId, data)
        break
      }

      case 'exit':
        match.session.status = 'closed'
        match.session.exitCode = event.exitCode
        appendDebug(match.session, `exit code=${event.exitCode} success=${event.success}`)
        if (!event.success)
          appendSystemLine(match.session, `[terminal] Process exited with code ${event.exitCode}`)
        // Auto-remove dead session from the owner's tab list
        {
          const owner = ensureOwner(match.ownerId)
          const idx = owner.sessions.findIndex(s => s.id === event.sessionId)
          if (idx !== -1) {
            owner.sessions.splice(idx, 1)
            if (owner.activeSessionId === event.sessionId) {
              owner.activeSessionId = owner.sessions[Math.max(0, idx - 1)]?.id
                ?? owner.sessions[0]?.id
                ?? null
            }
            if (!owner.sessions.length)
              owner.isPanelOpen = false
          }
          outputSubscribers.delete(event.sessionId)
        }
        break

      case 'error':
        match.session.status = 'error'
        match.session.error = event.message
        appendDebug(match.session, `error ${event.message}`)
        appendSystemLine(match.session, `[terminal] ${event.message}`)
        break
    }
  }

  function subscribeToOutput(sessionId: string, cb: (data: string) => void): () => void {
    let subs = outputSubscribers.get(sessionId)
    if (!subs) {
      subs = new Set()
      outputSubscribers.set(sessionId, subs)
    }
    subs.add(cb)
    return () => {
      subs!.delete(cb)
      if (subs!.size === 0)
        outputSubscribers.delete(sessionId)
    }
  }

  function openPanel(ownerId: string) {
    ensureOwner(ownerId).isPanelOpen = true
  }

  function closePanel(ownerId: string) {
    ensureOwner(ownerId).isPanelOpen = false
  }

  function togglePanel(ownerId: string) {
    const owner = ensureOwner(ownerId)
    owner.isPanelOpen = !owner.isPanelOpen
  }

  function setHeightPercent(ownerId: string, percent: number) {
    ensureOwner(ownerId).heightPercent = Math.min(MAX_HEIGHT_PERCENT, Math.max(MIN_HEIGHT_PERCENT, percent))
  }

  function setTerminalPosition(ownerId: string, position: TerminalOwnerPosition) {
    ensureOwner(ownerId).position = position
  }

  function setSplitPercent(ownerId: string, percent: number) {
    const normalized = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)))
    ensureOwner(ownerId).splitPercent = normalized
  }

  async function createSession(ownerId: string, cwd?: string | null) {
    await ensureTerminalEvents()

    const owner = ensureOwner(ownerId)
    const sessionId = `term_${makeId()}`
    const createdAt = now()
    const session: TerminalSessionState = {
      id: sessionId,
      title: 'Terminal',
      cwd: cwd ?? null,
      shell: '',
      status: 'starting',
      exitCode: null,
      error: '',
      buffer: '',
      hasReceivedOutput: false,
      debugSteps: [],
      createdAt,
      updatedAt: createdAt,
    }

    appendDebug(session, `createSession cwd=${cwd ?? '<none>'}`)
    owner.sessions.push(session)
    owner.activeSessionId = sessionId
    owner.isPanelOpen = true

    try {
      appendDebug(session, 'terminal_start invoke begin')
      const started = await startTerminalSession({
        sessionId,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        ...(cwd !== undefined ? { cwd } : {}),
      })

      session.cwd = started.cwd
      session.shell = started.shell
      session.title = titleFromShell(started.shell, started.cwd)
      session.status = 'ready'
      session.updatedAt = now()
      appendDebug(session, `terminal_start resolved shell=${started.shell || '<empty>'} cwd=${started.cwd}`)
    }
    catch (error) {
      session.status = 'error'
      session.error = error instanceof Error ? error.message : String(error)
      appendDebug(session, `terminal_start failed ${session.error}`)
      appendSystemLine(session, `[terminal] ${session.error}`)
    }

    return session
  }

  async function ensureVisibleSession(ownerId: string, cwd?: string | null) {
    const owner = ensureOwner(ownerId)
    owner.isPanelOpen = true

    if (!owner.sessions.length)
      return await createSession(ownerId, cwd)

    if (!owner.activeSessionId)
      owner.activeSessionId = owner.sessions[owner.sessions.length - 1]?.id ?? null

    return owner.sessions.find(session => session.id === owner.activeSessionId) ?? null
  }

  async function writeToSession(sessionId: string, data: string) {
    const match = findSession(sessionId)
    if (!match || match.session.status === 'closed')
      return

    try {
      await writeTerminalSession({ sessionId, data })
    }
    catch (error) {
      match.session.status = 'error'
      match.session.error = error instanceof Error ? error.message : String(error)
      appendDebug(match.session, `write failed ${match.session.error}`)
      appendSystemLine(match.session, `[terminal] ${match.session.error}`)
      throw error
    }
  }

  function activateSession(ownerId: string, sessionId: string) {
    const owner = ensureOwner(ownerId)
    if (owner.sessions.some(session => session.id === sessionId))
      owner.activeSessionId = sessionId
  }

  async function closeSession(ownerId: string, sessionId: string) {
    const owner = ensureOwner(ownerId)
    const index = owner.sessions.findIndex(session => session.id === sessionId)
    if (index === -1)
      return

    outputSubscribers.delete(sessionId)

    // Kill the process first, then clean up UI
    try {
      await closeTerminalSession(sessionId)
    }
    catch (error) {
      console.warn('[TerminalStore] Failed to close terminal session:', error)
    }

    // Now safe to remove from UI
    owner.sessions.splice(index, 1)

    if (owner.activeSessionId === sessionId) {
      owner.activeSessionId = owner.sessions[Math.max(0, index - 1)]?.id
        ?? owner.sessions[0]?.id
        ?? null
    }

    if (!owner.sessions.length)
      owner.isPanelOpen = false
  }

  async function disposeOwner(ownerId: string) {
    const owner = owners.value[ownerId]
    if (!owner)
      return

    const sessionIds = owner.sessions.map(session => session.id)
    delete owners.value[ownerId]

    for (const sessionId of sessionIds)
      outputSubscribers.delete(sessionId)

    await Promise.allSettled(sessionIds.map(async sessionId => {
      await closeTerminalSession(sessionId)
    }))
  }

  return {
    owners,
    getOwner,
    openPanel,
    closePanel,
    togglePanel,
    setHeightPercent,
    setTerminalPosition,
    setSplitPercent,
    createSession,
    ensureVisibleSession,
    writeToSession,
    activateSession,
    closeSession,
    disposeOwner,
    subscribeToOutput,
    async teardown() {
      if (terminalEventsUnlisten) {
        await terminalEventsUnlisten()
        terminalEventsUnlisten = null
        terminalEventsBound = false
      }
      outputSubscribers.clear()
    },
  }
})
