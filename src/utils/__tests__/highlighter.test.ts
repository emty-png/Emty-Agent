import { describe, expect, it } from 'vitest'
import { langFromPath } from '../highlighter'

describe('highlighter', () => {
  describe('langFromPath', () => {
    // ── TypeScript / JavaScript ─────────────────────────────────────────────

    it('maps .ts to typescript', () => {
      expect(langFromPath('src/index.ts')).toBe('typescript')
    })

    it('maps .tsx to tsx', () => {
      expect(langFromPath('App.tsx')).toBe('tsx')
    })

    it('maps .js to javascript', () => {
      expect(langFromPath('lib/utils.js')).toBe('javascript')
    })

    it('maps .jsx to jsx', () => {
      expect(langFromPath('Button.jsx')).toBe('jsx')
    })

    // ── Vue / HTML / CSS ────────────────────────────────────────────────────

    it('maps .vue to vue', () => {
      expect(langFromPath('components/Header.vue')).toBe('vue')
    })

    it('maps .html to html', () => {
      expect(langFromPath('index.html')).toBe('html')
    })

    it('maps .css to css', () => {
      expect(langFromPath('styles/main.css')).toBe('css')
    })

    it('maps .scss to scss', () => {
      expect(langFromPath('styles/vars.scss')).toBe('scss')
    })

    // ── Config / Data formats ───────────────────────────────────────────────

    it('maps .json to json', () => {
      expect(langFromPath('package.json')).toBe('json')
    })

    it('maps .jsonc to jsonc', () => {
      expect(langFromPath('tsconfig.jsonc')).toBe('jsonc')
    })

    it('maps .yaml and .yml to yaml', () => {
      expect(langFromPath('docker-compose.yaml')).toBe('yaml')
      expect(langFromPath('action.yml')).toBe('yaml')
    })

    it('maps .toml to toml', () => {
      expect(langFromPath('Cargo.toml')).toBe('toml')
    })

    // ── Systems / Scripting ─────────────────────────────────────────────────

    it('maps .rs to rust', () => {
      expect(langFromPath('src-tauri/main.rs')).toBe('rust')
    })

    it('maps .py to python', () => {
      expect(langFromPath('scripts/build.py')).toBe('python')
    })

    it('maps .sh and .bash to bash', () => {
      expect(langFromPath('deploy.sh')).toBe('bash')
      expect(langFromPath('deploy.bash')).toBe('bash')
    })

    it('maps .env to bash', () => {
      expect(langFromPath('.env')).toBe('bash')
    })

    // ── Documentation ───────────────────────────────────────────────────────

    it('maps .md to markdown', () => {
      expect(langFromPath('README.md')).toBe('markdown')
    })

    it('maps .mdx to mdx', () => {
      expect(langFromPath('docs/index.mdx')).toBe('mdx')
    })

    // ── Other ────────────────────────────────────────────────────────────────

    it('maps .sql to sql', () => {
      expect(langFromPath('migrations/001.sql')).toBe('sql')
    })

    it('maps .graphql and .gql to graphql', () => {
      expect(langFromPath('schema.graphql')).toBe('graphql')
      expect(langFromPath('query.gql')).toBe('graphql')
    })

    it('maps .lock to plaintext', () => {
      // Note: pnpm-lock.yaml has .yaml extension, not .lock
      expect(langFromPath('package-lock.lock')).toBe('plaintext')
    })

    // ── Unknown / edge cases ────────────────────────────────────────────────

    it('returns plaintext for unknown extensions', () => {
      expect(langFromPath('image.png')).toBe('plaintext')
      expect(langFromPath('binary.exe')).toBe('plaintext')
      expect(langFromPath('data.xml')).toBe('plaintext')
    })

    it('returns plaintext for files with no extension', () => {
      expect(langFromPath('Makefile')).toBe('plaintext')
      expect(langFromPath('Dockerfile')).toBe('plaintext')
    })

    it('returns plaintext for empty extension', () => {
      expect(langFromPath('file.')).toBe('plaintext')
      expect(langFromPath('')).toBe('plaintext')
    })

    it('is case-insensitive for extension matching', () => {
      expect(langFromPath('src/Index.TS')).toBe('typescript')
      expect(langFromPath('App.VUE')).toBe('vue')
      expect(langFromPath('readme.MD')).toBe('markdown')
    })

    it('uses the last segment after the last dot', () => {
      expect(langFromPath('file.backup.ts')).toBe('typescript')
    })
  })
})
