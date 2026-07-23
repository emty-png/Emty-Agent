import { join } from '@tauri-apps/api/path'
import { mkdir, readDir, writeTextFile } from '@tauri-apps/plugin-fs'
import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project'

// re-export for backward compatibility
export type { FileDisplayType } from '@/utils/fileClassify'

// ── types ─────────────────────────────────────────────────────────────────────
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  depth: number
  children?: FileNode[]
  expanded: boolean
  loading: boolean
}

// ── constants ─────────────────────────────────────────────────────────────────
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.output',
  'target', // Rust
  '.next',
  '.nuxt',
  '.svelte-kit', // frameworks
  'coverage',
  '.nyc_output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
])

const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

const EXCLUDED_HIDDEN = new Set([
  '.prettierrc',
  '.eslintrc',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
])

// ── helpers ───────────────────────────────────────────────────────────────────
function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir)
      return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

async function readLevel(dirPath: string, depth: number): Promise<FileNode[]> {
  const entries = await readDir(dirPath)
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (!entry.name)
      continue
    if (!entry.isFile && !entry.isDirectory)
      continue
    if (entry.isDirectory && EXCLUDED_DIRS.has(entry.name))
      continue
    if (entry.isFile && EXCLUDED_FILES.has(entry.name))
      continue
    if (entry.name.startsWith('.') && !EXCLUDED_HIDDEN.has(entry.name))
      continue

    const fullPath = await join(dirPath, entry.name)

    nodes.push({
      name: entry.name,
      path: fullPath,
      isDir: entry.isDirectory,
      depth,
      expanded: false,
      loading: false,
    })
  }

  return sortNodes(nodes)
}

function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === targetPath)
      return n
    if (n.isDir && n.children) {
      const found = findNodeByPath(n.children, targetPath)
      if (found)
        return found
    }
  }
  return null
}

// ── store ─────────────────────────────────────────────────────────────────────
export const useFileTreeStore = defineStore('fileTree', () => {
  const project = useProjectStore()
  const { projectPath } = storeToRefs(project)

  const tree = ref<FileNode[]>([])
  const loadingTree = ref(false)
  const error = ref<string | null>(null)

  // ── load root tree ─────────────────────────────────────────────────────────
  async function loadTree() {
    if (!projectPath.value)
      return
    loadingTree.value = true
    error.value = null

    try {
      tree.value = await readLevel(projectPath.value, 0)
    }
    catch (e) {
      error.value = String(e)
    }
    finally {
      loadingTree.value = false
    }
  }

  // ── expand / collapse folder ───────────────────────────────────────────────
  async function toggleDir(node: FileNode) {
    if (!node.isDir)
      return

    if (node.expanded) {
      node.expanded = false
      return
    }

    // lazy-load children on first expand
    if (!node.children) {
      node.loading = true
      try {
        node.children = await readLevel(node.path, node.depth + 1)
      }
      catch (e) {
        error.value = String(e)
      }
      finally {
        node.loading = false
      }
    }

    node.expanded = true
  }

  // ── collapse all folders ──────────────────────────────────────────────────
  function collapseAll() {
    function walk(nodes: FileNode[]) {
      for (const n of nodes) {
        if (n.isDir) {
          n.expanded = false
          if (n.children)
            walk(n.children)
        }
      }
    }
    walk(tree.value)
  }

  // ── expand to path (for fuzzy finder) ─────────────────────────────────────
  async function expandToPath(targetPath: string) {
    if (!projectPath.value)
      return

    const normalized = targetPath.replace(/\\/g, '/')
    const rootNormalized = projectPath.value.replace(/\\/g, '/')

    if (!normalized.startsWith(rootNormalized))
      return

    const relative = normalized.slice(rootNormalized.length).replace(/^\/+/, '')
    const segments = relative.split('/').slice(0, -1) // exclude filename

    let currentNodes = tree.value

    for (const segment of segments) {
      const dirNode = currentNodes.find(
        n => n.isDir && n.name === segment,
      )

      if (!dirNode)
        return

      if (!dirNode.expanded)
        await toggleDir(dirNode)

      currentNodes = dirNode.children ?? []
    }
  }

  // ── create file ───────────────────────────────────────────────────────────
  async function createFile(parentPath: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed)
      return

    const fullPath = await join(parentPath, trimmed)
    await writeTextFile(fullPath, '')

    // Refresh parent's children
    const parentNode = findNodeByPath(tree.value, parentPath)
    if (parentNode && parentNode.isDir) {
      const newNodes = await readLevel(parentPath, parentNode.depth + 1)
      parentNode.children = newNodes
      parentNode.expanded = true
    }
  }

  // ── create folder ─────────────────────────────────────────────────────────
  async function createFolder(parentPath: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed)
      return

    const fullPath = await join(parentPath, trimmed)
    await mkdir(fullPath)

    // Refresh parent's children
    const parentNode = findNodeByPath(tree.value, parentPath)
    if (parentNode && parentNode.isDir) {
      const newNodes = await readLevel(parentPath, parentNode.depth + 1)
      parentNode.children = newNodes
      parentNode.expanded = true
    }
  }

  // ── refresh tree nodes along a path ────────────────────────────────────────
  async function refreshTreeToPath(targetDirPath: string) {
    const normalized = targetDirPath.replace(/\\/g, '/')
    const root = projectPath.value?.replace(/\\/g, '/') ?? ''
    if (!normalized.startsWith(root))
      return

    const relative = normalized.slice(root.length).replace(/^\/+/, '')
    const segments = relative.split('/').filter(Boolean)

    let currentNodes = tree.value
    for (const segment of segments) {
      const dirNode = currentNodes.find(n => n.isDir && n.name === segment)
      if (!dirNode)
        return

      if (!dirNode.expanded || !dirNode.children) {
        dirNode.loading = true
        try {
          dirNode.children = await readLevel(dirNode.path, dirNode.depth + 1)
        }
        finally {
          dirNode.loading = false
        }
        dirNode.expanded = true
      }
      currentNodes = dirNode.children ?? []
    }
  }

  // ── create file at nested path ────────────────────────────────────────────
  async function createFileAtPath(parentPath: string, relativePath: string) {
    const trimmed = relativePath.trim().replace(/^\/+/, '')
    if (!trimmed)
      return

    // block path traversal
    const segments = trimmed.split(/[/\\]/).filter(Boolean)
    if (segments.includes('..'))
      return

    const filename = segments.pop()!
    const parentDir = segments.length > 0 ? await join(parentPath, ...segments) : parentPath

    await mkdir(parentDir, { recursive: true })
    const fullPath = await join(parentDir, filename)
    await writeTextFile(fullPath, '')

    await refreshTreeToPath(parentDir)
  }

  // ── create folder at nested path ──────────────────────────────────────────
  async function createFolderAtPath(parentPath: string, relativePath: string) {
    const trimmed = relativePath.trim().replace(/^\/+/, '')
    if (!trimmed)
      return

    // block path traversal
    const segments = trimmed.split(/[/\\]/).filter(Boolean)
    if (segments.includes('..'))
      return

    const fullPath = await join(parentPath, ...segments)
    await mkdir(fullPath, { recursive: true })

    await refreshTreeToPath(fullPath)
  }

  // ── find node by path ─────────────────────────────────────────────────────
  function findNode(path: string): FileNode | null {
    return findNodeByPath(tree.value, path)
  }

  // ── get all file paths (recursive) ────────────────────────────────────────
  function getAllFilePaths(): string[] {
    const paths: string[] = []

    function walk(nodes: FileNode[]) {
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children)
            walk(n.children)
        }
        else {
          paths.push(n.path)
        }
      }
    }

    walk(tree.value)
    return paths
  }

  // reload when project changes
  function reset() {
    tree.value = []
    error.value = null
  }

  return {
    tree,
    loadingTree,
    error,
    loadTree,
    toggleDir,
    collapseAll,
    expandToPath,
    createFile,
    createFolder,
    createFileAtPath,
    createFolderAtPath,
    findNode,
    getAllFilePaths,
    reset,
  }
})
