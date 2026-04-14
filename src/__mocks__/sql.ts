import { vi } from 'vitest'

export const mockDb = {
  select: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue({}),
}

export default class Database {
  static load = vi.fn(() => Promise.resolve(mockDb))
}
