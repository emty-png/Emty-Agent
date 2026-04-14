import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // stub Tauri plugin imports for test environment
      '@tauri-apps/plugin-dialog': resolve(__dirname, 'src/__mocks__/dialog.ts'),
      '@tauri-apps/plugin-fs': resolve(__dirname, 'src/__mocks__/fs.ts'),
      '@tauri-apps/api/path': resolve(__dirname, 'src/__mocks__/path.ts'),
      '@tauri-apps/api/window': resolve(__dirname, 'src/__mocks__/window.ts'),
      '@tauri-apps/plugin-sql': resolve(__dirname, 'src/__mocks__/sql.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
