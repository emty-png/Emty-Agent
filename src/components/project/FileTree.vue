<script setup lang="ts">
import type { PropType } from 'vue'
import type { FileNode } from '@/stores/fileTree'
import {
  ChevronRight,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder,
  FolderArchive,
  FolderCode,
  FolderGit2,
  FolderOpen,
  FolderSearch,
  Loader,
  Settings,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { defineComponent, h, resolveComponent } from 'vue'
import { useFileTreeStore } from '@/stores/fileTree'
import { getDeviconForFile } from '@/utils/icons'

const ft = useFileTreeStore()
const { tree, selectedPath, loadingTree } = storeToRefs(ft)

// ── file icon / color by extension ───────────────────────────────────────────
interface FileStyle {
  icon: typeof File
  color: string
}

const EXT_STYLE: Record<string, FileStyle> = {
  // typescript / javascript
  ts: { icon: FileCode, color: '#90cce0' },
  tsx: { icon: FileCode, color: '#90cce0' },
  js: { icon: FileCode, color: '#d4aa68' },
  jsx: { icon: FileCode, color: '#d4aa68' },
  // vue
  vue: { icon: FileCode, color: '#88be94' },
  // styles
  css: { icon: FileCode, color: '#6aaec8' },
  scss: { icon: FileCode, color: '#6aaec8' },
  // data
  json: { icon: FileJson, color: '#d4aa68' },
  jsonc: { icon: FileJson, color: '#d4aa68' },
  yaml: { icon: FileJson, color: '#f0a060' },
  yml: { icon: FileJson, color: '#f0a060' },
  toml: { icon: FileJson, color: '#f0a060' },
  // markup
  html: { icon: FileCode, color: '#f0a060' },
  md: { icon: FileText, color: '#ede5d8' },
  mdx: { icon: FileText, color: '#ede5d8' },
  // rust
  rs: { icon: FileCode, color: '#e07830' },
  // python
  py: { icon: FileCode, color: '#88be94' },
  // config
  env: { icon: Settings, color: '#d88080' },
  lock: { icon: Settings, color: '#504438' },
  // images
  png: { icon: FileImage, color: '#b8a0d8' },
  jpg: { icon: FileImage, color: '#b8a0d8' },
  jpeg: { icon: FileImage, color: '#b8a0d8' },
  gif: { icon: FileImage, color: '#b8a0d8' },
  webp: { icon: FileImage, color: '#b8a0d8' },
  svg: { icon: FileImage, color: '#d8b880' },
  ico: { icon: FileImage, color: '#d8b880' },
  // media
  mp4: { icon: FileVideo, color: '#a0b8d8' },
  mov: { icon: FileVideo, color: '#a0b8d8' },
  mp3: { icon: FileVideo, color: '#a0b8d8' },
  wav: { icon: FileVideo, color: '#a0b8d8' },
  // archives
  zip: { icon: FileArchive, color: '#b8b8a0' },
  gz: { icon: FileArchive, color: '#b8b8a0' },
  tar: { icon: FileArchive, color: '#b8b8a0' },
  rar: { icon: FileArchive, color: '#b8b8a0' },
  '7z': { icon: FileArchive, color: '#b8b8a0' },
}

function folderStyle(name: string, expanded: boolean): { icon: typeof Folder | typeof FolderOpen; color: string } {
  const n = name.toLowerCase()
  let icon = expanded ? FolderOpen : Folder
  let color = '#d4aa68' // default folder yellow

  if (n === 'src' || n === 'lib' || n === 'source') {
    icon = FolderCode
    color = '#88be94'
  }
  else if (n === 'public' || n === 'static' || n === 'assets' || n === 'images' || n === 'img') {
    icon = FolderSearch
    color = '#90cce0'
  }
  else if (n === 'node_modules' || n === 'vendor' || n === 'deps') {
    icon = FolderArchive
    color = '#d88080'
  }
  else if (n === 'dist' || n === 'build' || n === 'out' || n === 'target' || n === 'bin') {
    icon = FolderArchive
    color = '#a59688'
  }
  else if (n === '.git' || n === '.github' || n === '.gitlab') {
    icon = FolderGit2
    color = '#f0a060'
  }
  else if (n === '.vscode' || n === '.idea' || n === '.config' || n === 'config') {
    icon = Settings
    color = '#ede5d8'
  }
  else if (n === 'tests' || n === 'test' || n === '__tests__' || n === 'spec') {
    icon = FolderSearch
    color = '#88be94'
  }

  return { icon, color }
}

function fileStyle(name: string): FileStyle {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_STYLE[ext] ?? { icon: File, color: '#8a7868' }
}

const FileTreeNode = defineComponent({
  name: 'FileTreeNode',
  props: {
    node: { type: Object as PropType<FileNode>, required: true },
    selectedPath: { type: String as PropType<string | null>, default: null },
    toggleDir: { type: Function as PropType<(node: FileNode) => void>, required: true },
    selectFile: { type: Function as PropType<(node: FileNode) => void>, required: true },
  },
  emits: ['select'],
  setup(props, { emit }) {
    function onClick() {
      if (props.node.isDir) {
        props.toggleDir(props.node)
      }
      else {
        props.selectFile(props.node)
        emit('select')
      }
    }

    return { onClick, fileStyle }
  },
  render() {
    const { node, selectedPath } = this
    const fs = fileStyle(node.name)
    const { icon: FolderIcon, color: folderColor } = folderStyle(node.name, node.expanded || false)
    const FileTreeNodeComp = resolveComponent('FileTreeNode')

    const indent = { paddingLeft: `${node.depth * 14 + 8}px` }
    const isSelected = !node.isDir && node.path === selectedPath

    const row = h(
      'button',
      {
        class: ['node-row', isSelected && 'node-row--selected'],
        style: indent,
        onClick: this.onClick,
      },
      [
        // chevron (dir only)
        node.isDir
          ? h(ChevronRight, {
              size: 12,
              strokeWidth: 2,
              class: ['node-chevron', node.expanded && 'node-chevron--open'],
            })
          : h('span', { class: 'node-chevron-spacer' }),

        // icon
        node.isDir
          ? h(FolderIcon, { size: 13, strokeWidth: 1.6, class: 'node-folder-icon', style: { color: folderColor } })
          : node.loading
            ? h(Loader, {
                size: 13,
                strokeWidth: 1.6,
                class: 'spin node-file-icon',
                style: { color: '#504438' },
              })
            : getDeviconForFile(node.name)
              ? h('i', {
                  class: ['node-file-icon', getDeviconForFile(node.name)],
                  style: { fontSize: '13px', color: fs.color },
                })
              : h(fs.icon, {
                  size: 13,
                  strokeWidth: 1.6,
                  class: 'node-file-icon',
                  style: { color: fs.color },
                }),

        // label
        h('span', { class: 'node-label' }, node.name),

        // loading spinner (dir expanding)
        node.loading ? h(Loader, { size: 11, strokeWidth: 2, class: 'spin node-loader' }) : null,
      ],
    )

    // children
    const children
      = node.isDir && node.expanded && node.children
        ? node.children.map(child =>
            h(FileTreeNodeComp, {
              key: child.path,
              node: child,
              selectedPath,
              toggleDir: this.toggleDir,
              selectFile: this.selectFile,
              onSelect: () => this.$emit('select'),
            }),
          )
        : []

    return h('div', { class: 'node-wrap' }, [row, ...children])
  },
})
</script>

<!-- ── recursive node component ────────────────────────────────────────────── -->
<template>
  <div class="tree-root">
    <!-- loading skeleton -->
    <div v-if="loadingTree" class="tree-loading">
      <Loader :size="14" :stroke-width="1.8" class="spin" />
      <span>Reading project…</span>
    </div>

    <!-- empty -->
    <div v-else-if="tree.length === 0" class="tree-empty">
      No files found
    </div>

    <!-- tree -->
    <template v-else>
      <FileTreeNode
        v-for="treeNode in tree"
        :key="treeNode.path"
        :node="treeNode"
        :selected-path="selectedPath"
        :toggle-dir="ft.toggleDir"
        :select-file="ft.selectFile"
        @select="ft.selectFile(treeNode)"
      />
    </template>
  </div>
</template>

<style scoped>
/* ── root ────────────────────────────────────────────────────────────────────── */
.tree-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 0;
  padding-bottom: 6px;
}

.tree-loading,
.tree-empty {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 12px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

/* ── node ────────────────────────────────────────────────────────────────────── */
:deep(.node-wrap) {
  display: flex;
  flex-direction: column;
}

:deep(.node-row) {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  height: 24px;
  padding-right: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--color-text-secondary);
  transition:
    background 120ms ease,
    color 120ms ease;
  white-space: nowrap;
  flex-shrink: 0;
}

:deep(.node-row:hover) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

:deep(.node-row--selected) {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

:deep(.node-row--selected:hover) {
  background: var(--color-accent-muted);
}

/* chevron */
:deep(.node-chevron) {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform 120ms ease;
}

:deep(.node-chevron--open) {
  transform: rotate(90deg);
}

:deep(.node-chevron-spacer) {
  display: inline-block;
  width: 12px;
  flex-shrink: 0;
}

/* icons */
:deep(.node-folder-icon) {
  flex-shrink: 0;
  color: var(--color-warning);
}

:deep(.node-file-icon) {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

/* label */
:deep(.node-label) {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* loader */
:deep(.node-loader) {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

/* spinner */
:deep(.spin) {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
