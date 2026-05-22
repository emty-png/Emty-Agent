import type { UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface TerminalStartResponse {
  sessionId: string
  cwd: string
  shell: string
}

export type TerminalEvent
  = | {
    type: 'started'
    sessionId: string
    shell: string
    cwd: string
  }
  | {
    type: 'output'
    sessionId: string
    data: string
  }
  | {
    type: 'exit'
    sessionId: string
    exitCode: number
    success: boolean
  }
  | {
    type: 'error'
    sessionId: string
    message: string
  }

export async function startTerminalSession(input: {
  sessionId: string
  cwd?: string | null
  cols: number
  rows: number
}) {
  return await invoke<TerminalStartResponse>('terminal_start', {
    request: input,
  })
}

export async function writeTerminalSession(input: {
  sessionId: string
  data: string
}) {
  await invoke('terminal_write', {
    request: input,
  })
}

export async function resizeTerminalSession(input: {
  sessionId: string
  cols: number
  rows: number
}) {
  await invoke('terminal_resize', {
    request: input,
  })
}

export async function closeTerminalSession(sessionId: string) {
  await invoke('terminal_close', {
    request: { sessionId },
  })
}

export async function listenToTerminalEvents(
  handler: (event: TerminalEvent) => void,
): Promise<UnlistenFn> {
  function normalize(raw: Record<string, unknown>): TerminalEvent {
    const type = raw.type as string
    switch (type) {
      case 'started':
        return {
          type: 'started',
          sessionId: (raw.sessionId ?? raw.session_id) as string,
          shell: raw.shell as string,
          cwd: raw.cwd as string,
        }
      case 'output':
        return {
          type: 'output',
          sessionId: (raw.sessionId ?? raw.session_id) as string,
          data: raw.data as string,
        }
      case 'exit':
        return {
          type: 'exit',
          sessionId: (raw.sessionId ?? raw.session_id) as string,
          exitCode: (raw.exitCode ?? raw.exit_code) as number,
          success: raw.success as boolean,
        }
      case 'error':
        return {
          type: 'error',
          sessionId: (raw.sessionId ?? raw.session_id) as string,
          message: raw.message as string,
        }
      default:
        return raw as unknown as TerminalEvent
    }
  }

  return await listen<Record<string, unknown>>('terminal://event', event => handler(normalize(event.payload)))
}
