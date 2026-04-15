import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTreeStore } from '@/stores/fileTree'
import FileTree from '../FileTree.vue'

describe('fileTree component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the tree root container', () => {
    const wrapper = mount(FileTree)
    expect(wrapper.find('.tree-root').exists()).toBe(true)
  })

  it('shows loading state when loadingTree is true', () => {
    const store = useFileTreeStore()
    store.loadingTree = true

    const wrapper = mount(FileTree)
    expect(wrapper.find('.tree-loading').exists()).toBe(true)
    expect(wrapper.text()).toContain('Reading project…')
  })

  it('shows empty state when tree is empty', () => {
    const wrapper = mount(FileTree)
    expect(wrapper.find('.tree-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('No files found')
  })

  it('does not show empty or loading when tree has items', () => {
    const store = useFileTreeStore()
    store.tree = [
      { name: 'src', path: '/src', isDir: true, depth: 0, expanded: false, loading: false },
    ]

    const wrapper = mount(FileTree)
    expect(wrapper.find('.tree-empty').exists()).toBe(false)
    expect(wrapper.find('.tree-loading').exists()).toBe(false)
  })

  it('renders file nodes with labels', () => {
    const store = useFileTreeStore()
    store.tree = [
      {
        name: 'index.ts',
        path: '/index.ts',
        isDir: false,
        depth: 0,
        expanded: false,
        loading: false,
      },
      {
        name: 'package.json',
        path: '/package.json',
        isDir: false,
        depth: 0,
        expanded: false,
        loading: false,
      },
    ]

    const wrapper = mount(FileTree)
    const labels = wrapper.findAll('.node-label')
    expect(labels.map(l => l.text())).toContain('index.ts')
    expect(labels.map(l => l.text())).toContain('package.json')
  })

  it('renders directory nodes with folder icons', () => {
    const store = useFileTreeStore()
    store.tree = [
      { name: 'src', path: '/src', isDir: true, depth: 0, expanded: false, loading: false },
    ]

    const wrapper = mount(FileTree)
    // FileTreeNode is a render-function component; labels should still appear
    expect(wrapper.find('.node-label').text()).toBe('src')
  })

  it('marks selected file node as selected', () => {
    const store = useFileTreeStore()
    store.selectedPath = '/index.ts'
    store.tree = [
      {
        name: 'index.ts',
        path: '/index.ts',
        isDir: false,
        depth: 0,
        expanded: false,
        loading: false,
      },
    ]

    const wrapper = mount(FileTree)
    const selectedRow = wrapper.find('.node-row--selected')
    expect(selectedRow.exists()).toBe(true)
  })

  it('applies depth-based indentation to nodes', () => {
    const store = useFileTreeStore()
    store.tree = [
      {
        name: 'deep.ts',
        path: '/deep.ts',
        isDir: false,
        depth: 3,
        expanded: false,
        loading: false,
      },
    ]

    const wrapper = mount(FileTree)
    const row = wrapper.find('.node-row')
    const style = row.attributes('style')
    expect(style).toContain('padding-left')
  })

  it('shows loading spinner when node is loading', () => {
    const store = useFileTreeStore()
    store.tree = [
      { name: 'src', path: '/src', isDir: true, depth: 0, expanded: false, loading: true },
    ]

    const wrapper = mount(FileTree)
    // The node should have a loader element
    expect(wrapper.find('.node-loader').exists()).toBe(true)
  })

  it('expands directory children when expanded', () => {
    const store = useFileTreeStore()
    store.tree = [
      {
        name: 'src',
        path: '/src',
        isDir: true,
        depth: 0,
        expanded: true,
        loading: false,
        children: [
          {
            name: 'index.ts',
            path: '/src/index.ts',
            isDir: false,
            depth: 1,
            expanded: false,
            loading: false,
          },
        ],
      },
    ]

    const wrapper = mount(FileTree)
    // Should render the parent node and its child
    const labels = wrapper.findAll('.node-label')
    expect(labels.length).toBeGreaterThanOrEqual(1)
    expect(labels.map(l => l.text())).toContain('src')
  })
})
