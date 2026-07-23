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
import { defineComponent, h, ref, resolveComponent, watch } from 'vue'
import CreateItemDialog from '@/components/project/CreateItemDialog.vue'
import { useFileTabsStore } from '@/stores/fileTabs'
import { useFileTreeStore } from '@/stores/fileTree'
import { useProjectStore } from '@/stores/project'

import { getDeviconForFile } from '@/utils/icons'

const ft = useFileTreeStore()
const tabs = useFileTabsStore()
const { tree, loadingTree } = storeToRefs(ft)
const { activeTab } = storeToRefs(tabs)

const showCreateDialog = defineModel<boolean>('showCreateDialog', { default: false })

const project = useProjectStore()
const { projectPath } = storeToRefs(project)

// ── context menu state ──────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number; nodePath: string; isDir: boolean } | null>(null)
const createTargetPath = ref<string>('')

function onContextMenu(e: MouseEvent, node: FileNode) {
  e.preventDefault()
  e.stopPropagation()

  const menuWidth = 140
  const menuHeight = 80
  let x = e.clientX
  let y = e.clientY

  if (x + menuWidth > window.innerWidth)
    x = window.innerWidth - menuWidth - 8
  if (y + menuHeight > window.innerHeight)
    y = window.innerHeight - menuHeight - 8

  contextMenu.value = { x, y, nodePath: node.path, isDir: node.isDir }
}

function closeContextMenu() {
  contextMenu.value = null
}

function handleContextAction() {
  if (!contextMenu.value)
    return
  const target = contextMenu.value

  // folder → create inside it; file → create in same parent directory
  let parent: string
  if (target.isDir) {
    parent = target.nodePath
  }
  else {
    const lastSlash = Math.max(target.nodePath.lastIndexOf('/'), target.nodePath.lastIndexOf('\\'))
    parent = lastSlash > 0 ? target.nodePath.substring(0, lastSlash) : projectPath.value ?? ''
  }

  createTargetPath.value = parent
  contextMenu.value = null
  showCreateDialog.value = true
}

function getRelativeBase(targetPath: string): string {
  if (!targetPath || !projectPath.value)
    return ''
  const normalized = targetPath.replace(/\\/g, '/')
  const root = projectPath.value.replace(/\\/g, '/')
  if (normalized === root)
    return ''
  const rel = normalized.slice(root.length).replace(/^\/+/, '')
  return rel ? `${rel}/` : ''
}

// close context menu on Escape
watch(contextMenu, val => {
  if (val) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        closeContextMenu()
    }
    window.addEventListener('keydown', onKeyDown, { once: true })
  }
})

async function handleCreate(type: 'file' | 'folder', name: string) {
  const parent = createTargetPath.value || (projectPath.value ?? '')
  if (type === 'file')
    await ft.createFileAtPath(parent, name)
  else
    await ft.createFolderAtPath(parent, name)
  showCreateDialog.value = false
  createTargetPath.value = ''
}

// ── file icon / color by extension ───────────────────────────────────────────
interface FileStyle {
  icon: typeof File
  color: string
}

const EXT_STYLE: Record<string, FileStyle> = {
  // typescript / javascript
  ts: { icon: FileCode, color: 'var(--file-color-ts)' },
  tsx: { icon: FileCode, color: 'var(--file-color-ts)' },
  js: { icon: FileCode, color: 'var(--file-color-js)' },
  jsx: { icon: FileCode, color: 'var(--file-color-js)' },
  // vue
  vue: { icon: FileCode, color: 'var(--file-color-vue)' },
  // styles
  css: { icon: FileCode, color: 'var(--file-color-css)' },
  scss: { icon: FileCode, color: 'var(--file-color-css)' },
  // data
  json: { icon: FileJson, color: 'var(--file-color-js)' },
  jsonc: { icon: FileJson, color: 'var(--file-color-js)' },
  yaml: { icon: FileJson, color: 'var(--file-color-data)' },
  yml: { icon: FileJson, color: 'var(--file-color-data)' },
  toml: { icon: FileJson, color: 'var(--file-color-data)' },
  // markup
  html: { icon: FileCode, color: 'var(--file-color-data)' },
  md: { icon: FileText, color: 'var(--file-color-doc)' },
  mdx: { icon: FileText, color: 'var(--file-color-doc)' },
  // rust
  rs: { icon: FileCode, color: 'var(--file-color-rust)' },
  // python
  py: { icon: FileCode, color: 'var(--file-color-vue)' },
  // config
  env: { icon: Settings, color: 'var(--file-color-config)' },
  lock: { icon: Settings, color: 'var(--file-color-lock)' },
  // images
  png: { icon: FileImage, color: 'var(--file-color-image)' },
  jpg: { icon: FileImage, color: 'var(--file-color-image)' },
  jpeg: { icon: FileImage, color: 'var(--file-color-image)' },
  gif: { icon: FileImage, color: 'var(--file-color-image)' },
  webp: { icon: FileImage, color: 'var(--file-color-image)' },
  svg: { icon: FileImage, color: 'var(--file-color-image-alt)' },
  ico: { icon: FileImage, color: 'var(--file-color-image-alt)' },
  // media
  mp4: { icon: FileVideo, color: 'var(--file-color-media)' },
  mov: { icon: FileVideo, color: 'var(--file-color-media)' },
  mp3: { icon: FileVideo, color: 'var(--file-color-media)' },
  wav: { icon: FileVideo, color: 'var(--file-color-media)' },
  // archives
  zip: { icon: FileArchive, color: 'var(--file-color-archive)' },
  gz: { icon: FileArchive, color: 'var(--file-color-archive)' },
  tar: { icon: FileArchive, color: 'var(--file-color-archive)' },
  rar: { icon: FileArchive, color: 'var(--file-color-archive)' },
  '7z': { icon: FileArchive, color: 'var(--file-color-archive)' },
}

function folderStyle(name: string, expanded: boolean): { icon: typeof Folder | typeof FolderOpen; color: string } {
  const n = name.toLowerCase()
  let icon = expanded ? FolderOpen : Folder
  let color = 'var(--file-color-folder)'

  if (n === 'src' || n === 'lib' || n === 'source') {
    icon = FolderCode
    color = 'var(--file-color-vue)'
  }
  else if (n === 'public' || n === 'static' || n === 'assets' || n === 'images' || n === 'img') {
    icon = FolderSearch
    color = 'var(--file-color-ts)'
  }
  else if (n === 'node_modules' || n === 'vendor' || n === 'deps') {
    icon = FolderArchive
    color = 'var(--file-color-config)'
  }
  else if (n === 'dist' || n === 'build' || n === 'out' || n === 'target' || n === 'bin') {
    icon = FolderArchive
    color = 'var(--file-color-folder-build)'
  }
  else if (n === '.git' || n === '.github' || n === '.gitlab') {
    icon = FolderGit2
    color = 'var(--file-color-data)'
  }
  else if (n === '.vscode' || n === '.idea' || n === '.config' || n === 'config') {
    icon = Settings
    color = 'var(--file-color-doc)'
  }
  else if (n === 'tests' || n === 'test' || n === '__tests__' || n === 'spec') {
    icon = FolderSearch
    color = 'var(--file-color-vue)'
  }

  return { icon, color }
}

function fileStyle(name: string): FileStyle {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_STYLE[ext] ?? { icon: File, color: 'var(--file-color-default)' }
}

const FileTreeNode = defineComponent({
  name: 'FileTreeNode',
  props: {
    node: { type: Object as PropType<FileNode>, required: true },
    activeTabPath: { type: String as PropType<string | null>, default: null },
    toggleDir: { type: Function as PropType<(node: FileNode) => void>, required: true },
    selectFile: { type: Function as PropType<(node: FileNode) => void>, required: true },
    onContextMenu: { type: Function as PropType<(e: MouseEvent, node: FileNode) => void>, default: null },
  },
  setup(props) {
    function onClick() {
      if (props.node.isDir) {
        props.toggleDir(props.node)
      }
      else {
        props.selectFile(props.node)
      }
    }

    return { onClick, fileStyle }
  },
  render() {
    const { node, activeTabPath } = this
    const fs = fileStyle(node.name)
    const { icon: FolderIcon, color: folderColor } = folderStyle(node.name, node.expanded || false)
    const FileTreeNodeComp = resolveComponent('FileTreeNode')

    const indent = { paddingLeft: `${node.depth * 14 + 8}px` }
    const isSelected = !node.isDir && node.path === activeTabPath

    const row = h(
      'button',
      {
        class: [
          'flex h-[24px] w-full shrink-0 cursor-pointer items-center gap-[5px] whitespace-nowrap border-none bg-transparent pr-[8px] text-left transition-[background,color] duration-[120ms] ease-[ease]',
          isSelected
            ? '!bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-muted)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)]',
        ],
        style: indent,
        onClick: this.onClick,
        onContextmenu: this.onContextMenu
          ? (e: MouseEvent) => this.onContextMenu(e, this.node)
          : undefined,
      },
      [
        // chevron (dir only)
        node.isDir
          ? h(ChevronRight, {
              size: 12,
              strokeWidth: 2,
              class: [
                'shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-[120ms] ease-[ease]',
                node.expanded ? 'rotate-90' : '',
              ],
            })
          : h('span', { class: 'inline-block w-[12px] shrink-0' }),

        // icon
        node.isDir
          ? h(FolderIcon, { size: 13, strokeWidth: 1.6, class: 'shrink-0', style: { color: folderColor } })
          : node.loading
            ? h(Loader, {
                size: 13,
                strokeWidth: 1.6,
                class: 'animate-spin flex h-[14px] w-[14px] shrink-0 items-center justify-center overflow-hidden',
                style: { color: 'var(--file-color-lock)' },
              })
            : getDeviconForFile(node.name)
              ? h('i', {
                  class: [
                    'flex h-[14px] w-[14px] shrink-0 items-center justify-center overflow-hidden',
                    getDeviconForFile(node.name),
                  ],
                  style: { fontSize: '13px', color: fs.color },
                })
              : h(fs.icon, {
                  size: 13,
                  strokeWidth: 1.6,
                  class: 'flex h-[14px] w-[14px] shrink-0 items-center justify-center overflow-hidden',
                  style: { color: fs.color },
                }),

        // label
        h('span', { class: 'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]' }, node.name),

        // loading spinner (dir expanding)
        node.loading ? h(Loader, { size: 11, strokeWidth: 2, class: 'animate-spin ml-auto shrink-0 text-[var(--color-text-tertiary)]' }) : null,
      ],
    )

    // children
    const children
      = node.isDir && node.expanded && node.children
        ? node.children.map(child =>
            h(FileTreeNodeComp, {
              key: child.path,
              node: child,
              activeTabPath,
              toggleDir: this.toggleDir,
              selectFile: this.selectFile,
              onContextMenu: this.onContextMenu,
            }),
          )
        : []

    return h('div', { class: 'flex flex-col' }, [row, ...children])
  },
})
</script>

<template>
  <div class="flex h-full flex-col overflow-x-hidden overflow-y-auto pb-[6px] pt-0">
    <!-- loading skeleton -->
    <div v-if="loadingTree" class="flex items-center gap-[7px] px-[12px] py-[12px] text-[12px] text-[var(--color-text-tertiary)]">
      <Loader :size="14" :stroke-width="1.8" class="animate-spin" />
      <span>Reading project…</span>
    </div>

    <!-- empty -->
    <div v-else-if="tree.length === 0" class="flex items-center gap-[7px] px-[12px] py-[12px] text-[12px] text-[var(--color-text-tertiary)]">
      No files found
    </div>

    <!-- tree -->
    <template v-else>
      <div class="relative flex-1">
        <FileTreeNode
          v-for="treeNode in tree"
          :key="treeNode.path"
          :node="treeNode"
          :active-tab-path="activeTab?.path ?? null"
          :toggle-dir="ft.toggleDir"
          :select-file="tabs.openFile"
          :on-context-menu="onContextMenu"
        />
      </div>
    </template>

    <!-- context menu -->
    <Teleport to="body">
      <div v-if="contextMenu" class="ctx-backdrop" @click="closeContextMenu" />
      <div
        v-if="contextMenu"
        class="ctx-menu"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <button class="ctx-item" @click="handleContextAction">
          <File :size="13" :stroke-width="1.8" />
          New File
        </button>
        <button class="ctx-item" @click="handleContextAction">
          <Folder :size="13" :stroke-width="1.8" />
          New Folder
        </button>
      </div>
    </Teleport>

    <!-- create item dialog -->
    <CreateItemDialog
      v-if="showCreateDialog"
      :parent-path="createTargetPath || projectPath || ''"
      :relative-base="getRelativeBase(createTargetPath)"
      @create="handleCreate"
      @close="showCreateDialog = false; createTargetPath = ''"
    />
  </div>
</template>
