import * as path from '@tauri-apps/api/path'
import * as fs from '@tauri-apps/plugin-fs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTreeStore } from '../fileTree'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  exists: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...p: string[]) => p.join('/')),
}))

describe('fileTree store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockDir(entries: fs.FileEntry[]): void {
    vi.mocked(fs.readDir).mockResolvedValueOnce(entries)
  }

  // ── initial state ───────────────────────────────────────────────────────────

  it('starts with empty tree and null selections', () => {
    const store = useFileTreeStore()
    expect(store.tree).toEqual([])
    expect(store.selectedPath).toBeNull()
    expect(store.fileContent).toBeNull()
    expect(store.loadingFile).toBe(false)
    expect(store.loadingTree).toBe(false)
    expect(store.error).toBeNull()
  })

  // ── loadTree ────────────────────────────────────────────────────────────────

  it('does nothing when projectPath is null', async () => {
    const store = useFileTreeStore()
    await store.loadTree()
    expect(fs.readDir).not.toHaveBeenCalled()
  })

  it('loads root tree when projectPath is set', async () => {
    const { useProjectStore } = await import('../project')
    useProjectStore().setProject('/proj')

    mockDir([
      { name: 'index.ts', isFile: true, isDirectory: false },
      { name: 'src', isFile: false, isDirectory: true },
    ])

    const store = useFileTreeStore()
    await store.loadTree()

    expect(path.join).toHaveBeenCalledWith('/proj', 'index.ts')
    expect(path.join).toHaveBeenCalledWith('/proj', 'src')
    expect(store.tree).toHaveLength(2)
    // dirs sorted first, then files
    expect(store.tree[0]!.name).toBe('src')
    expect(store.tree[0]!.isDir).toBe(true)
    expect(store.tree[1]!.name).toBe('index.ts')
    expect(store.tree[1]!.isDir).toBe(false)
    expect(store.tree[1]!.depth).toBe(0)
    expect(store.loadingTree).toBe(false)
  })

  it('sets loadingTree during load', async () => {
    const { useProjectStore } = await import('../project')
    useProjectStore().setProject('/proj')

    let resolveFn: (v: fs.FileEntry[]) => void
    vi.mocked(fs.readDir).mockReturnValueOnce(
      new Promise(resolve => { resolveFn = resolve }),
    )

    const store = useFileTreeStore()
    store.loadTree()
    expect(store.loadingTree).toBe(true)

    resolveFn!([])
    await store.loadTree()
  })

  it('sets error on load failure', async () => {
    const { useProjectStore } = await import('../project')
    useProjectStore().setProject('/proj')

    vi.mocked(fs.readDir).mockRejectedValueOnce(new Error('ENOENT'))

    const store = useFileTreeStore()
    await store.loadTree()

    expect(store.error).toBe('Error: ENOENT')
    expect(store.loadingTree).toBe(false)
  })

  // ── excluded dirs/files ─────────────────────────────────────────────────────

  it('excludes node_modules and .git directories', async () => {
    const { useProjectStore } = await import('../project')
    useProjectStore().setProject('/proj')

    mockDir([
      { name: 'package.json', isFile: true, isDirectory: false },
      { name: 'node_modules', isFile: false, isDirectory: true },
      { name: '.git', isFile: false, isDirectory: true },
      { name: 'src', isFile: false, isDirectory: true },
    ])

    const store = useFileTreeStore()
    await store.loadTree()

    expect(store.tree.map(n => n.name)).toEqual(['src', 'package.json'])
  })

  it('excludes common dot-files except allowed ones', async () => {
    const { useProjectStore } = await import('../project')
    useProjectStore().setProject('/proj')

    mockDir([
      { name: '.DS_Store', isFile: true, isDirectory: false },
      { name: '.eslintrc', isFile: true, isDirectory: false },
      { name: '.prettierrc', isFile: true, isDirectory: false },
      { name: '.env', isFile: true, isDirectory: false },
      { name: '.env.local', isFile: true, isDirectory: false },
      { name: '.gitignore', isFile: true, isDirectory: false },
    ])

    const store = useFileTreeStore()
    await store.loadTree()

    expect(store.tree.map(n => n.name)).toEqual([
      '.env',
      '.env.local',
      '.eslintrc',
      '.gitignore',
      '.prettierrc',
    ])
  })

  // ── toggleDir ───────────────────────────────────────────────────────────────

  it('does nothing for files', async () => {
    const store = useFileTreeStore()
    const file = { name: 'x.ts', path: '/x.ts', isDir: false, depth: 0, expanded: false, loading: false }
    await store.toggleDir(file)
    expect(file.expanded).toBe(false)
  })

  it('collapses an expanded directory', async () => {
    const store = useFileTreeStore()
    const dir = { name: 'src', path: '/src', isDir: true, depth: 0, expanded: true, loading: false, children: [] }
    await store.toggleDir(dir)
    expect(dir.expanded).toBe(false)
  })

  it('lazy-loads children on first expand', async () => {
    mockDir([
      { name: 'a.ts', isFile: true, isDirectory: false },
      { name: 'b.ts', isFile: true, isDirectory: false },
    ])

    const store = useFileTreeStore()
    const dir = { name: 'src', path: '/src', isDir: true, depth: 0, expanded: false, loading: false }
    await store.toggleDir(dir)

    expect(dir.expanded).toBe(true)
    expect(dir.children).toHaveLength(2)
    expect(dir.children![0]!.depth).toBe(1)
  })

  it('sets error on toggleDir failure', async () => {
    vi.mocked(fs.readDir).mockRejectedValueOnce(new Error('EACCES'))

    const store = useFileTreeStore()
    const dir = { name: 'locked', path: '/locked', isDir: true, depth: 0, expanded: false, loading: false }
    await store.toggleDir(dir)

    expect(store.error).toBe('Error: EACCES')
    // The dir was set to expanded=true before loading; error doesn't revert it
    expect(dir.expanded).toBe(true)
  })

  // ── selectFile ──────────────────────────────────────────────────────────────

  it('reads file content and sets selectedPath', async () => {
    vi.mocked(fs.readTextFile).mockResolvedValueOnce('export const x = 1')

    const store = useFileTreeStore()
    const file = { name: 'x.ts', path: '/x.ts', isDir: false, depth: 0, expanded: false, loading: false }
    await store.selectFile(file)

    expect(fs.readTextFile).toHaveBeenCalledWith('/x.ts')
    expect(store.selectedPath).toBe('/x.ts')
    expect(store.fileContent).toBe('export const x = 1')
    expect(store.loadingFile).toBe(false)
  })

  it('does nothing when selecting the same file again', async () => {
    const store = useFileTreeStore()
    store.selectedPath = '/x.ts'

    const file = { name: 'x.ts', path: '/x.ts', isDir: false, depth: 0, expanded: false, loading: false }
    await store.selectFile(file)

    expect(fs.readTextFile).not.toHaveBeenCalled()
  })

  it('toggles directory when selecting a dir', async () => {
    mockDir([
      { name: 'child.ts', isFile: true, isDirectory: false },
    ])

    const store = useFileTreeStore()
    const dir = { name: 'src', path: '/src', isDir: true, depth: 0, expanded: false, loading: false }
    await store.selectFile(dir)

    expect(dir.expanded).toBe(true)
    expect(store.selectedPath).toBeNull()
  })

  it('sets error on file read failure', async () => {
    vi.mocked(fs.readTextFile).mockRejectedValueOnce(new Error('ENOENT'))

    const store = useFileTreeStore()
    const file = { name: 'missing.ts', path: '/missing.ts', isDir: false, depth: 0, expanded: false, loading: false }
    await store.selectFile(file)

    expect(store.error).toBe('Error: ENOENT')
    expect(store.fileContent).toBeNull()
    expect(store.loadingFile).toBe(false)
  })

  // ── reset ───────────────────────────────────────────────────────────────────

  it('clears all state', () => {
    const store = useFileTreeStore()
    store.tree = [{ name: 'x', path: '/x', isDir: false, depth: 0, expanded: false, loading: false }]
    store.selectedPath = '/x'
    store.fileContent = 'content'
    store.error = 'err'

    store.reset()

    expect(store.tree).toEqual([])
    expect(store.selectedPath).toBeNull()
    expect(store.fileContent).toBeNull()
    expect(store.error).toBeNull()
  })

  // ── sortNodes ───────────────────────────────────────────────────────────────

  it('sorts directories before files, then alphabetically with numeric', async () => {
    const { useProjectStore } = await import('../project')
    useProjectStore().setProject('/proj')

    mockDir([
      { name: 'zebra.ts', isFile: true, isDirectory: false },
      { name: 'alpha', isFile: false, isDirectory: true },
      { name: '2.ts', isFile: true, isDirectory: false },
      { name: '10.ts', isFile: true, isDirectory: false },
      { name: 'beta', isFile: false, isDirectory: true },
    ])

    const store = useFileTreeStore()
    await store.loadTree()

    expect(store.tree.map(n => n.name)).toEqual(['alpha', 'beta', '2.ts', '10.ts', 'zebra.ts'])
  })
})
