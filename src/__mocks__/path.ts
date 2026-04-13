import { vi } from 'vitest'

export const join = vi.fn((...parts: string[]) => parts.join('/'))
