import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import Titlebar from '../Titlebar.vue'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
  }),
}))

describe('titlebar', () => {
  it('renders the provided title', () => {
    const wrapper = mount(Titlebar, { props: { title: 'My App' } })
    expect(wrapper.text()).toContain('My App')
  })

  it('renders icon slot content', () => {
    const wrapper = mount(Titlebar, {
      props: { title: 'App' },
      slots: { icon: '<span data-testid="icon">★</span>' },
    })
    expect(wrapper.find('[data-testid="icon"]').text()).toBe('★')
  })

  it('renders center slot content', () => {
    const wrapper = mount(Titlebar, {
      props: { title: 'App' },
      slots: { center: '<span data-testid="center">dashboard</span>' },
    })
    expect(wrapper.find('[data-testid="center"]').text()).toBe('dashboard')
  })
})
