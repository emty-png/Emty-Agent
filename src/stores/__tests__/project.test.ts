import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectStore } from '../project'

describe('project store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ── initial state ───────────────────────────────────────────────────────────

  it('starts with null projectPath and projectName', () => {
    const store = useProjectStore()
    expect(store.projectPath).toBeNull()
    expect(store.projectName).toBeNull()
  })

  // ── setProject ──────────────────────────────────────────────────────────────

  it('sets projectPath and derives projectName from forward-slash path', () => {
    const store = useProjectStore()
    store.setProject('/home/user/my-project')
    expect(store.projectPath).toBe('/home/user/my-project')
    expect(store.projectName).toBe('my-project')
  })

  it('sets projectPath and derives projectName from backslash path', () => {
    const store = useProjectStore()
    store.setProject('C:\\Users\\Empty\\my-app')
    expect(store.projectPath).toBe('C:\\Users\\Empty\\my-app')
    expect(store.projectName).toBe('my-app')
  })

  it('trims trailing separators before deriving name', () => {
    const store = useProjectStore()
    store.setProject('/home/user/project/')
    expect(store.projectName).toBe('project')

    store.setProject('C:\\Users\\test\\project\\\\')
    expect(store.projectName).toBe('project')
  })

  it('clears project when given empty string', () => {
    const store = useProjectStore()
    store.setProject('/some/path')
    store.setProject('')
    expect(store.projectPath).toBeNull()
    expect(store.projectName).toBeNull()
  })

  it('clears project when given whitespace-only string', () => {
    const store = useProjectStore()
    store.setProject('/some/path')
    store.setProject('   ')
    expect(store.projectPath).toBeNull()
    expect(store.projectName).toBeNull()
  })

  // ── clearProject ────────────────────────────────────────────────────────────

  it('clears project directly', () => {
    const store = useProjectStore()
    store.setProject('/some/path')
    store.clearProject()
    expect(store.projectPath).toBeNull()
    expect(store.projectName).toBeNull()
  })

  // ── projectName edge cases ──────────────────────────────────────────────────

  it('returns null projectName when projectPath is null', () => {
    const store = useProjectStore()
    expect(store.projectName).toBeNull()
  })

  it('derives name from single-level path', () => {
    const store = useProjectStore()
    store.setProject('project')
    expect(store.projectName).toBe('project')
  })

  it('derives name from root-like path', () => {
    const store = useProjectStore()
    store.setProject('/')
    // split('/') gives ['', ''], pop() gives '', which is correct behavior
    expect(store.projectName).toBe('')
  })
})
