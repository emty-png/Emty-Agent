import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useProjectStore } from './project'

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
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', '.output',
  'target',                          // Rust
  '.next', '.nuxt', '.svelte-kit',   // frameworks
  'coverage', '.nyc_output',
  '.turbo', '.cache', '.parcel-cache',
  '__pycache__', '.pytest_cache',
  '.venv', 'venv', 'env',
  '.idea', '.vscode',
])

const EXCLUDED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
])

// ── helpers ───────────────────────────────────────────────────────────────────
function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

async function readLevel(dirPath: string, depth: number): Promise<FileNode[]> {
  const entries = await readDir(dirPath)
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (!entry.name) continue
    if (entry.isDirectory && EXCLUDED_DIRS.has(entry.name)) continue
    if (entry.isFile && EXCLUDED_FILES.has(entry.name)) continue
    // skip hidden files except .env variants and common dot-configs
    if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) {
      const allowed = new Set(['.prettierrc', '.eslintrc', '.gitignore', '.npmrc', '.nvmrc'])
      if (!allowed.has(entry.name)) continue
    }

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

// ── store ─────────────────────────────────────────────────────────────────────
export const useFileTreeStore = defineStore('fileTree', () => {
  const project = useProjectStore()
  const { projectPath } = storeToRefs(project)

  const tree = ref<FileNode[]>([])
  const selectedPath = ref<string | null>(null)
  const fileContent = ref<string | null>(null)
  const loadingFile = ref(false)
  const loadingTree = ref(false)
  const error = ref<string | null>(null)

  // ── load root tree ─────────────────────────────────────────────────────────
  async function loadTree() {
    if (!projectPath.value) return
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
    if (!node.isDir) return

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

  // ── select & read file ─────────────────────────────────────────────────────
  async function selectFile(node: FileNode) {
    if (node.isDir) { await toggleDir(node); return }
    if (selectedPath.value === node.path) return

    selectedPath.value = node.path
    fileContent.value = null
    loadingFile.value = true
    error.value = null

    try {
      fileContent.value = await readTextFile(node.path)
    }
    catch (e) {
      error.value = String(e)
      fileContent.value = null
    }
    finally {
      loadingFile.value = false
    }
  }

  // reload when project changes
  function reset() {
    tree.value = []
    selectedPath.value = null
    fileContent.value = null
    error.value = null
  }

  return {
    tree, selectedPath, fileContent,
    loadingFile, loadingTree, error,
    loadTree, toggleDir, selectFile, reset,
  }
})