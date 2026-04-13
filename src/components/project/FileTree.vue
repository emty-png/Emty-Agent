<script setup lang="ts">
import { Loader } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useFileTreeStore } from '@/stores/fileTree'

const ft = useFileTreeStore()
const { tree, selectedPath, loadingTree } = storeToRefs(ft)

</script>

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
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :selected-path="selectedPath"
      />
    </template>

  </div>
</template>

<!-- ── recursive node component ────────────────────────────────────────────── -->
<script lang="ts">
import { defineComponent, h, resolveComponent } from 'vue'
import type { PropType } from 'vue'
import {
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  FolderOpen,
  Folder,
  Loader as NodeLoader,
  Settings,
} from 'lucide-vue-next'
import { type FileNode, useFileTreeStore as useTreeStore } from '@/stores/fileTree'

// ── file icon / color by extension ───────────────────────────────────────────
interface FileStyle { icon: typeof File; color: string }

const EXT_STYLE: Record<string, FileStyle> = {
  // typescript / javascript
  ts:   { icon: FileCode, color: '#90cce0' },
  tsx:  { icon: FileCode, color: '#90cce0' },
  js:   { icon: FileCode, color: '#d4aa68' },
  jsx:  { icon: FileCode, color: '#d4aa68' },
  // vue
  vue:  { icon: FileCode, color: '#88be94' },
  // styles
  css:  { icon: FileCode, color: '#6aaec8' },
  scss: { icon: FileCode, color: '#6aaec8' },
  // data
  json: { icon: FileJson, color: '#d4aa68' },
  jsonc:{ icon: FileJson, color: '#d4aa68' },
  yaml: { icon: FileJson, color: '#f0a060' },
  yml:  { icon: FileJson, color: '#f0a060' },
  toml: { icon: FileJson, color: '#f0a060' },
  // markup
  html: { icon: FileCode, color: '#f0a060' },
  md:   { icon: FileText, color: '#ede5d8' },
  mdx:  { icon: FileText, color: '#ede5d8' },
  // rust
  rs:   { icon: FileCode, color: '#e07830' },
  // python
  py:   { icon: FileCode, color: '#88be94' },
  // config
  env:  { icon: Settings, color: '#d88080' },
  lock: { icon: Settings, color: '#504438' },
}

function fileStyle(name: string): FileStyle {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_STYLE[ext] ?? { icon: File, color: '#8a7868' }
}

export const FileTreeNode = defineComponent({
  name: 'FileTreeNode',
  props: {
    node:         { type: Object as PropType<FileNode>, required: true },
    selectedPath: { type: String as PropType<string | null>, default: null },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const ft = useTreeStore()

    function onClick() {
      if (props.node.isDir) {
        ft.toggleDir(props.node)
      }
      else {
        ft.selectFile(props.node)
        emit('select')
      }
    }

    return { onClick, fileStyle }
  },
  render() {
    const { node, selectedPath } = this
    const fs = fileStyle(node.name)
    const FolderIcon = node.expanded ? FolderOpen : Folder
    const FileTreeNodeComp = resolveComponent('FileTreeNode')

    const indent = { paddingLeft: `${node.depth * 14 + 8}px` }
    const isSelected = !node.isDir && node.path === selectedPath

    const row = h('button', {
      class: ['node-row', isSelected && 'node-row--selected'],
      style: indent,
      onClick: this.onClick,
    }, [
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
        ? h(FolderIcon, { size: 13, strokeWidth: 1.6, class: 'node-folder-icon' })
        : node.loading
          ? h(NodeLoader, { size: 13, strokeWidth: 1.6, class: 'spin node-file-icon', style: { color: '#504438' } })
          : h(fs.icon, { size: 13, strokeWidth: 1.6, class: 'node-file-icon', style: { color: fs.color } }),

      // label
      h('span', { class: 'node-label' }, node.name),

      // loading spinner (dir expanding)
      node.loading
        ? h(NodeLoader, { size: 11, strokeWidth: 2, class: 'spin node-loader' })
        : null,
    ])

    // children
    const children = node.isDir && node.expanded && node.children
      ? node.children.map(child =>
          h(FileTreeNodeComp, {
            key: child.path,
            node: child,
            selectedPath,
            onSelect: () => this.$emit('select'),
          })
        )
      : []

    return h('div', { class: 'node-wrap' }, [row, ...children])
  },
})
</script>

<style scoped>
/* ── root ────────────────────────────────────────────────────────────────────── */
.tree-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding-block: 6px;
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
  outline: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--color-text-secondary);
  transition: background 100ms ease, color 100ms ease;
  white-space: nowrap;
  flex-shrink: 0;
}

:deep(.node-row:hover) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

:deep(.node-row--selected) {
  background: var(--color-ember-glow);
  color: var(--color-ember-text);
}

:deep(.node-row--selected:hover) {
  background: var(--color-ember-glow);
}

/* chevron */
:deep(.node-chevron) {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform 150ms ease;
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
  color: var(--color-gold);
}

:deep(.node-file-icon) {
  flex-shrink: 0;
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
  to { transform: rotate(360deg); }
}
</style>