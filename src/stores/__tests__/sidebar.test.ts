import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSidebarStore } from '../sidebar'

describe('sidebar store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts not collapsed', () => {
    const store = useSidebarStore()
    expect(store.collapsed).toBe(false)
  })

  it('toggles collapsed state', () => {
    const store = useSidebarStore()
    store.toggle()
    expect(store.collapsed).toBe(true)
    store.toggle()
    expect(store.collapsed).toBe(false)
  })

  it('sets collapsed state directly', () => {
    const store = useSidebarStore()
    store.setCollapsed(true)
    expect(store.collapsed).toBe(true)
    store.setCollapsed(false)
    expect(store.collapsed).toBe(false)
  })
})
