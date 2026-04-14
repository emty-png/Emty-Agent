import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import Sidebar from '../Sidebar.vue'

describe('sidebar component', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the sidebar element', () => {
    const wrapper = mount(Sidebar)
    expect(wrapper.find('aside.sidebar').exists()).toBe(true)
  })

  it('renders all nav buttons with labels', () => {
    const wrapper = mount(Sidebar)
    const buttons = wrapper.findAll('.sidebar-btn')

    expect(buttons.length).toBeGreaterThanOrEqual(4) // collapse + chat + history + projects + settings
    expect(wrapper.text()).toContain('Chat')
    expect(wrapper.text()).toContain('History')
    expect(wrapper.text()).toContain('Projects')
    expect(wrapper.text()).toContain('Settings')
  })

  it('highlights Chat as active by default', () => {
    const wrapper = mount(Sidebar)
    const btns = wrapper.findAll('.sidebar-btn')
    const chatBtn = btns.find(b => b.text().includes('Chat'))
    expect(chatBtn?.classes()).toContain('sidebar-btn--active')
  })

  it('highlights History when activeView is history', () => {
    const wrapper = mount(Sidebar, { props: { activeView: 'history' } })
    const btns = wrapper.findAll('.sidebar-btn')
    const historyBtn = btns.find(b => b.text().includes('History'))
    expect(historyBtn?.classes()).toContain('sidebar-btn--active')
    const chatBtn = btns.find(b => b.text().includes('Chat'))
    expect(chatBtn?.classes()).not.toContain('sidebar-btn--active')
  })

  it('highlights Projects when activeView is projects', () => {
    const wrapper = mount(Sidebar, { props: { activeView: 'projects' } })
    const btns = wrapper.findAll('.sidebar-btn')
    const projectsBtn = btns.find(b => b.text().includes('Projects'))
    expect(projectsBtn?.classes()).toContain('sidebar-btn--active')
  })

  it('emits selectView with chat when Chat button clicked', async () => {
    const wrapper = mount(Sidebar)
    const btns = wrapper.findAll('.sidebar-btn')
    const chatBtn = btns.find(b => b.text().includes('Chat'))
    await chatBtn!.trigger('click')
    expect(wrapper.emitted('selectView')).toEqual([['chat']])
  })

  it('emits selectView with history when History button clicked', async () => {
    const wrapper = mount(Sidebar)
    const btns = wrapper.findAll('.sidebar-btn')
    const historyBtn = btns.find(b => b.text().includes('History'))
    await historyBtn!.trigger('click')
    expect(wrapper.emitted('selectView')).toEqual([['history']])
  })

  it('emits selectView with projects when Projects button clicked', async () => {
    const wrapper = mount(Sidebar)
    const btns = wrapper.findAll('.sidebar-btn')
    const projectsBtn = btns.find(b => b.text().includes('Projects'))
    await projectsBtn!.trigger('click')
    expect(wrapper.emitted('selectView')).toEqual([['projects']])
  })

  it('toggles collapse when toggle button clicked', async () => {
    const wrapper = mount(Sidebar)
    const aside = wrapper.find('aside.sidebar')
    expect(aside.classes()).not.toContain('sidebar--collapsed')

    const toggleBtn = wrapper.find('.sidebar-btn--toggle')
    await toggleBtn.trigger('click')

    expect(aside.classes()).toContain('sidebar--collapsed')
  })

  it('renders slot content in the nav area', () => {
    const wrapper = mount(Sidebar, {
      slots: { default: '<button class="custom-nav-btn">Custom</button>' },
    })
    expect(wrapper.find('.custom-nav-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('Custom')
  })

  it('shows collapse icon when not collapsed', () => {
    const wrapper = mount(Sidebar)
    const icons = wrapper.findAll('.icon-swap__icon')
    // PanelLeftClose should be visible, PanelLeftOpen hidden
    const visibleIcons = icons.filter(i => !i.classes().includes('icon-swap__icon--hidden'))
    expect(visibleIcons.length).toBeGreaterThanOrEqual(1)
  })
})
