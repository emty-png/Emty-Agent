import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface GitLogLine {
  id: string
  tabId: string
  cwd: string
  timestamp: number
  command: string
  durationMs: number
  exitCode: number | null
  stdout?: string | undefined
  stderr?: string | undefined
}

const MAX_PER_TAB = 1000
const STORE_OUTPUT_LIMIT = 2000

function makeId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function truncateStoreField(value: string | undefined, limit = STORE_OUTPUT_LIMIT): string | undefined {
  if (!value)
    return undefined
  const t = value.trim()
  if (!t)
    return undefined
  if (t.length > limit)
    return `${t.slice(0, limit)}\n… truncated ${t.length - limit} chars`
  return t
}

export const useGitLogsStore = defineStore('gitLogs', () => {
  const logsByTab = ref<Record<string, GitLogLine[]>>({})

  function push(line: Omit<GitLogLine, 'id'>): void {
    const entry: GitLogLine = {
      ...line,
      stdout: truncateStoreField(line.stdout),
      stderr: truncateStoreField(line.stderr),
      id: makeId(),
    }
    const list = logsByTab.value[line.tabId] ?? []
    list.push(entry)
    if (list.length > MAX_PER_TAB)
      list.splice(0, list.length - MAX_PER_TAB)
    logsByTab.value[line.tabId] = list
  }

  function getLogs(tabId: string): GitLogLine[] {
    return logsByTab.value[tabId] ?? []
  }

  function clear(tabId: string): void {
    logsByTab.value[tabId] = []
  }

  function disposeOwner(tabId: string): void {
    delete logsByTab.value[tabId]
  }

  return {
    logsByTab,
    push,
    getLogs,
    clear,
    disposeOwner,
  }
})
