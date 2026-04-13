import { vi } from 'vitest'

export const readDir = vi.fn(() => Promise.resolve([]))
export const readTextFile = vi.fn(() => Promise.resolve(''))
export const exists = vi.fn(() => Promise.resolve(false))
