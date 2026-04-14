import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from '../ChatInput.vue'

describe('chatInput component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a textarea', () => {
    const wrapper = mount(ChatInput)
    expect(wrapper.find('textarea.input-field').exists()).toBe(true)
  })

  it('renders toolbar buttons', () => {
    const wrapper = mount(ChatInput)
    expect(wrapper.findAll('.tool-btn').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.find('.model-btn').exists()).toBe(true)
  })

  it('renders model name', () => {
    const wrapper = mount(ChatInput)
    expect(wrapper.find('.model-name').text()).toBe('Sonnet 4.6')
    expect(wrapper.find('.model-badge').text()).toBe('Extended')
  })

  it('emits send with trimmed text on Enter key', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Hello world')
    await textarea.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toEqual([['Hello world']])
  })

  it('does not emit on blank input', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.setValue('   ')
    await textarea.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('clears textarea after submit', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Test')
    await textarea.trigger('keydown', { key: 'Enter' })

    expect(textarea.element.value).toBe('')
  })

  it('does not submit on Shift+Enter', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Line 1\nLine 2')

    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })
    textarea.element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('adds focus class on focus event', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.trigger('focus')
    expect(wrapper.find('.input-shell').classes()).toContain('input-shell--focused')
  })

  it('removes focus class on blur event', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.trigger('focus')
    await textarea.trigger('blur')
    expect(wrapper.find('.input-shell').classes()).not.toContain('input-shell--focused')
  })

  it('has placeholder text', () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('placeholder')).toBe('Type / for skills')
  })

  it('sets rows to 1 by default', () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('rows')).toBe('1')
  })

  it('auto-grow adjusts height on input', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')

    // Set a value and trigger input
    await textarea.setValue('A'.repeat(500))
    await textarea.trigger('input')

    // Height should be set (not 'auto' anymore after onInput runs)
    expect(textarea.element.style.height).not.toBe('')
    expect(textarea.element.style.height).not.toBe('auto')
  })

  it('prevents default on Enter keydown', async () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.find('textarea')
    await textarea.setValue('test')

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    textarea.element.dispatchEvent(event)

    expect(preventDefaultSpy).toHaveBeenCalled()
  })
})
