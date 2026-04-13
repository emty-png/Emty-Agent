import { vi } from 'vitest'

export const open = vi.fn(() => Promise.resolve('/mock/path'))
