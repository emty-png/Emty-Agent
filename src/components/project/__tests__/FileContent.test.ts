import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as highlighter from '@/utils/highlighter'

import FileContent from '../FileContent.vue'

// Mock the highlighter
vi.mock('@/utils/highlighter', () => ({
  getHighlighter: vi.fn(),
  langFromPath: vi.fn(() => 'typescript'),
}))

describe('fileContent component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows empty state when no file is selected', () => {
    const wrapper = mount(FileContent)
    expect(wrapper.find('.content-empty').exists()).toBe(true)
    expect(wrapper.find('.empty-label').text()).toContain('Select a file')
  })

  it('shows loading state when loadingFile is true', async () => {
    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/test.ts'
    store.loadingFile = true

    const wrapper = mount(FileContent)
    expect(wrapper.find('.content-loading').exists()).toBe(true)
  })

  it('shows error state when error is set', async () => {
    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/test.ts'
    store.fileContent = null
    store.error = 'File not found'
    store.loadingFile = false

    const wrapper = mount(FileContent)
    expect(wrapper.find('.content-error').exists()).toBe(true)
    expect(wrapper.find('.content-error').text()).toBe('File not found')
  })

  it('renders breadcrumb from selectedPath', async () => {
    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/deep/path/to/file.ts'
    store.fileContent = 'const x = 1'
    store.loadingFile = false
    store.error = null

    const wrapper = mount(FileContent)
    expect(wrapper.find('.breadcrumb').exists()).toBe(true)
    // breadcrumb shows last 3 parts
    const parts = wrapper.findAll('.breadcrumb-part')
    // The breadcrumb splits by '/' so we check for the filename
    expect(parts.map(p => p.text()).join('')).toContain('file.ts')
  })

  it('calls highlighter when fileContent changes', async () => {
    const mockHighlighter = {
      codeToHtml: vi.fn(() => '<pre class="shiki"><code>const x = 1</code></pre>'),
    }
    vi.mocked(highlighter.getHighlighter).mockResolvedValue(mockHighlighter as any)

    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/test.ts'
    store.fileContent = 'const x = 1'
    store.loadingFile = false
    store.error = null

    const wrapper = mount(FileContent)
    await flushPromises()

    expect(highlighter.getHighlighter).toHaveBeenCalled()
    expect(mockHighlighter.codeToHtml).toHaveBeenCalledWith('const x = 1', {
      lang: 'typescript',
      theme: 'ember-dark',
    })
  })

  it('renders highlighted content when available', async () => {
    const mockHighlighter = {
      codeToHtml: vi.fn(() => '<pre class="shiki"><code>const x = 1</code></pre>'),
    }
    vi.mocked(highlighter.getHighlighter).mockResolvedValue(mockHighlighter as any)

    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/test.ts'
    store.fileContent = 'const x = 1'
    store.loadingFile = false
    store.error = null

    const wrapper = mount(FileContent)
    await flushPromises()

    expect(wrapper.find('.code-wrap').exists()).toBe(true)
    expect(wrapper.html()).toContain('const x = 1')
  })

  it('falls back to plain text on highlighter error', async () => {
    vi.mocked(highlighter.getHighlighter).mockRejectedValue(new Error('highlighter fail'))

    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/test.ts'
    store.fileContent = 'raw content'
    store.loadingFile = false
    store.error = null

    const wrapper = mount(FileContent)
    await flushPromises()

    expect(wrapper.find('.code-wrap').exists()).toBe(true)
    expect(wrapper.html()).toContain('raw content')
  })

  it('cleares highlighted when content becomes null', async () => {
    const mockHighlighter = {
      codeToHtml: vi.fn(() => '<pre class="shiki"><code>content</code></pre>'),
    }
    vi.mocked(highlighter.getHighlighter).mockResolvedValue(mockHighlighter as any)

    const { useFileTreeStore } = await import('@/stores/fileTree')
    const store = useFileTreeStore()
    store.selectedPath = '/test.ts'
    store.fileContent = 'content'
    store.loadingFile = false
    store.error = null

    const wrapper = mount(FileContent)
    await flushPromises()
    expect(wrapper.find('.code-wrap').exists()).toBe(true)

    store.fileContent = null
    await flushPromises()

    expect(wrapper.find('.code-wrap').exists()).toBe(false)
  })
})
