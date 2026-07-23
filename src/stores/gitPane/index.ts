/**
 * src/stores/gitPane.ts
 *
 * Pinia store for the Git GUI pane state.
 * Mirrors the browser store's panel toggle pattern — each tab (owner)
 * gets its own open/close + split percent state.
 *
 * The git pane and browser pane are mutually exclusive:
 * opening one closes the other.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBrowserStore } from '@/stores/browser'

export interface DiffViewerData {
  filePath: string
  diff: string
  added: number
  removed: number
}

export interface GitPaneOwnerState {
  isPanelOpen: boolean
  splitPercent: number
  includeUnstagedOnCommit: boolean
  skipCommitHooks: boolean
  amendCommit: boolean
  closedPanes: string[]
  diffViewerData: DiffViewerData | null
}

const DEFAULT_SPLIT_PERCENT = 50

function createOwnerState(): GitPaneOwnerState {
  return {
    isPanelOpen: false,
    splitPercent: DEFAULT_SPLIT_PERCENT,
    includeUnstagedOnCommit: true,
    skipCommitHooks: false,
    amendCommit: false,
    closedPanes: [],
    diffViewerData: null,
  }
}

export const useGitPaneStore = defineStore('gitPane', () => {
  const owners = ref<Record<string, GitPaneOwnerState>>({})

  function ensureOwner(ownerId: string): GitPaneOwnerState {
    owners.value[ownerId] ??= createOwnerState()
    return owners.value[ownerId]!
  }

  function getOwner(ownerId: string): GitPaneOwnerState {
    return ensureOwner(ownerId)
  }

  function openPanel(ownerId: string): void {
    // Mutual exclusivity: close browser pane first
    const browser = useBrowserStore()
    browser.closePanel(ownerId)

    ensureOwner(ownerId).isPanelOpen = true
  }

  function closePanel(ownerId: string): void {
    ensureOwner(ownerId).isPanelOpen = false
  }

  function togglePanel(ownerId: string): void {
    const owner = ensureOwner(ownerId)
    if (owner.isPanelOpen)
      closePanel(ownerId)
    else
      openPanel(ownerId)
  }

  function setSplitPercent(ownerId: string, percent: number): void {
    // Normalize and clamp percent to a valid range [0, 100]. Store as integer.
    const normalized = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)))
    ensureOwner(ownerId).splitPercent = normalized
  }

  function setCommitOptions(ownerId: string, patch: Partial<Pick<GitPaneOwnerState, 'includeUnstagedOnCommit' | 'skipCommitHooks' | 'amendCommit'>>): void {
    const owner = ensureOwner(ownerId)
    owner.includeUnstagedOnCommit = patch.includeUnstagedOnCommit ?? owner.includeUnstagedOnCommit
    owner.skipCommitHooks = patch.skipCommitHooks ?? owner.skipCommitHooks
    owner.amendCommit = patch.amendCommit ?? owner.amendCommit
  }

  function setClosedPanes(ownerId: string, panes: string[]): void {
    ensureOwner(ownerId).closedPanes = panes
  }

  function openDiffViewer(ownerId: string, data: DiffViewerData): void {
    const owner = ensureOwner(ownerId)
    owner.diffViewerData = data
    openPanel(ownerId)
  }

  function disposeOwner(ownerId: string): void {
    delete owners.value[ownerId]
  }

  return {
    owners,
    getOwner,
    openPanel,
    closePanel,
    togglePanel,
    setSplitPercent,
    setCommitOptions,
    setClosedPanes,
    openDiffViewer,
    disposeOwner,
  }
})
