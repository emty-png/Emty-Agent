import { vi } from 'vitest'

export const getCurrentWindow = vi.fn(() => ({
  isMaximized: () => Promise.resolve(false),
  onResized: () => Promise.resolve(() => {}),
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  close: vi.fn(),
}))
