import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import Titlebar from '../Titlebar.vue'

describe('titlebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

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
