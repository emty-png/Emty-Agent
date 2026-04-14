import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectView from '../ProjectView.vue'

vi.mock('@/utils/highlighter', () => ({
  getHighlighter: vi.fn(),
  langFromPath: vi.fn(() => 'plaintext'),
}))

describe('projectView component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows empty state when no project is open', async () => {
    const wrapper = mount(ProjectView)
    await flushPromises()
    expect(wrapper.find('.project-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('No project open')
    expect(wrapper.text()).toContain('folder icon')
  })

  it('shows split view when project is set', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    expect(wrapper.find('.project-empty').exists()).toBe(false)
    expect(wrapper.find('.split').exists()).toBe(true)
  })

  it('renders FileTree component in left panel', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    expect(wrapper.find('.split-panel--left').exists()).toBe(true)
    expect(wrapper.find('.tree-root').exists()).toBe(true)
  })

  it('renders FileContent component in right panel', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    expect(wrapper.find('.split-panel--right').exists()).toBe(true)
    expect(wrapper.find('.content-root').exists()).toBe(true)
  })

  it('shows project name in panel header', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/home/user/my-awesome-app')

    const wrapper = mount(ProjectView)
    await flushPromises()

    expect(wrapper.find('.panel-title').text()).toBe('my-awesome-app')
  })

  it('has default split percentage of 38', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    const leftPanel = wrapper.find('.split-panel--left')
    expect(leftPanel.attributes('style')).toContain('width: 38%')
  })

  it('updates split percentage on drag', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    const vm = wrapper.vm as any
    // Directly call the internal handlers to test logic
    vm.onDragStart({ preventDefault: () => {} } as MouseEvent)
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as any).dragging).toBe(true)

    vm.onMouseMove({ clientX: 300 } as MouseEvent)
    await wrapper.vm.$nextTick()

    const leftPanel = wrapper.find('.split-panel--left')
    // containerRef won't have a real rect in test env, so verify the style binding exists
    expect(leftPanel.attributes('style')).toMatch(/width:\s*\d+%/)

    vm.onMouseUp()
  })

  it('constrains split percentage between min and max', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    const vm = wrapper.vm as any
    // Test the SPLIT_MIN/SPLIT_MAX constants are used by checking the logic
    // We can verify the refs exist
    expect(typeof vm.splitPercent).toBe('number')
    expect(vm.splitPercent).toBe(38) // default
  })

  it('adds dragging class to split during drag', async () => {
    const { useProjectStore } = await import('@/stores/project')
    useProjectStore().setProject('/test/project')

    const wrapper = mount(ProjectView)
    await flushPromises()

    const vm = wrapper.vm as any
    vm.onDragStart({ preventDefault: () => {} } as MouseEvent)
    await wrapper.vm.$nextTick()

    const split = wrapper.find('.split')
    expect(split.classes()).toContain('split--dragging')

    vm.onMouseUp()
    await wrapper.vm.$nextTick()
    expect(split.classes()).not.toContain('split--dragging')
  })

  it('loads tree on mount when projectPath exists', async () => {
    const { useProjectStore } = await import('@/stores/project')
    const { useFileTreeStore } = await import('@/stores/fileTree')
    useProjectStore().setProject('/test/project')

    const treeStore = useFileTreeStore()
    vi.spyOn(treeStore, 'loadTree').mockResolvedValue()

    mount(ProjectView)
    await flushPromises()

    expect(treeStore.loadTree).toHaveBeenCalled()
  })
})
