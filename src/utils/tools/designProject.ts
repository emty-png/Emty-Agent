/**
 * Design project tools: scaffold_project, create_design_files, edit_design_files, build_project
 *
 * Used exclusively in 'design' mode. These tools manage file-based design projects
 * stored in ~/.emty/designs/{project_name}/.
 */

import type { DesignProjectType } from '@/stores/chat/core/types'
import { homeDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { Command } from '@tauri-apps/plugin-shell'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

// ── Dev server management ─────────────────────────────────────────────────────

/** Preferred port for design preview dev servers. Vite auto-increments if busy. */
const DESIGN_PREVIEW_PORT = 5190

/** Active dev server child processes keyed by project path. */
const devServers = new Map<string, { kill: () => Promise<void> }>()

export async function stopDevServer(projectPath: string): Promise<void> {
  const entry = devServers.get(projectPath)
  if (entry) {
    console.warn(`[dev-server] Stopping dev server for ${projectPath}`)
    try { await entry.kill() }
    catch { /* ignore */ }
    devServers.delete(projectPath)
    console.warn(`[dev-server] ✓ Stopped dev server for ${projectPath}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type ShellBinary = 'sh' | 'powershell' | 'pwsh' | 'git-bash' | 'git-bash-x86'

async function getDesignsRoot(): Promise<string> {
  const home = await homeDir()
  return join(home, '.emty', 'designs')
}

function createShellArgs(shell: ShellBinary, command: string): string[] {
  if (shell === 'powershell' || shell === 'pwsh')
    return ['-NoProfile', '-NonInteractive', '-Command', command]
  if (shell === 'git-bash' || shell === 'git-bash-x86')
    return ['-lc', command]
  return ['-c', command]
}

async function resolveShell(): Promise<ShellBinary> {
  const { platform } = await import('@tauri-apps/plugin-os')
  const currentPlatform = await platform()
  if (currentPlatform !== 'windows')
    return 'sh'

  // Try sh first (Git Bash or WSL)
  try {
    const result = await Command.create('sh', ['-c', 'exit 0']).execute()
    if (result.code === 0)
      return 'sh'
  }
  catch { /* ignore */ }

  // Try pwsh (PowerShell 7)
  try {
    const result = await Command.create('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']).execute()
    if (result.code === 0)
      return 'pwsh'
  }
  catch { /* ignore */ }

  // Fall back to Windows PowerShell
  return 'powershell'
}

async function runShellCommand(cwd: string, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const shell = await resolveShell()
  const args = createShellArgs(shell, command)
  const cmd = Command.create(shell, args, { cwd })
  const result = await cmd.execute()
  return {
    code: result.code ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  if (!(await exists(dirPath))) {
    await mkdir(dirPath, { recursive: true })
  }
}

async function write_file(filePath: string, content: string): Promise<void> {
  // Handle both forward and back slashes for Windows compatibility
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : ''
  if (dir)
    await ensureDir(dir)
  await writeTextFile(filePath, content)
}

// ── Vite template files ──────────────────────────────────────────────────────

function getViteTemplateFiles(type: DesignProjectType, name: string): Array<{ path: string; content: string }> {
  const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})
`

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${displayName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`

  const viteSvg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="31.88" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 257"><defs><linearGradient id="IconifyId1813088fe1fbc01fb466" x1="-.828%" x2="57.636%" y1="7.652%" y2="78.411%"><stop offset="0%" stop-color="#41D1FF"></stop><stop offset="100%" stop-color="#BD34FE"></stop></linearGradient><linearGradient id="IconifyId1813088fe1fbc01fb467" x1="43.376%" x2="50.316%" y1="2.242%" y2="89.03%"><stop offset="0%" stop-color="#FFBD4F"></stop><stop offset="100%" stop-color="#FF9640"></stop></linearGradient></defs><path fill="url(#IconifyId1813088fe1fbc01fb466)" d="M255.153 37.938L134.897 252.976c-2.483 4.44-8.862 4.466-11.382.048L.875 37.958c-2.746-4.814 1.371-10.646 6.827-9.67l120.385 21.517a6.537 6.537 0 0 0 2.322-.004l117.867-21.483c5.438-.991 9.574 4.796 6.877 9.62Z"></path><path fill="url(#IconifyId1813088fe1fbc01fb467)" d="M185.432.063L96.44 17.501a3.268 3.268 0 0 0-2.634 3.014l-5.474 92.456a3.268 3.268 0 0 0 3.997 3.378l24.777-5.718c2.318-.535 4.413 1.507 3.936 3.838l-7.361 36.047c-.495 2.426 1.782 4.5 4.151 3.78l15.304-4.649c2.372-.72 4.652 1.36 4.15 3.788l-11.698 56.621c-.732 3.542 3.979 5.473 5.943 2.437l1.313-2.028l72.516-144.72c1.215-2.423-.88-5.186-3.54-4.672l-25.505 4.922c-2.396.462-4.435-1.77-3.759-4.114l16.646-57.705c.677-2.35-1.37-4.583-3.769-4.113Z"></path></svg>'

  if (type === 'vite-react') {
    const packageJson = `{
  "name": "${name}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.1",
    "vite": "^6.3.2"
  }
}
`
    const mainJsx = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
    const indexCss = `:root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`
    const appJsx = `import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <h1>Vite + React</h1>
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            count is {count}
          </button>
          <p>
            Edit <code>src/App.jsx</code> and save to test HMR
          </p>
        </div>
        <p className="read-the-docs">
          Click on the Vite and React logos to learn more
        </p>
      </div>
    </>
  )
}

export default App
`
    const appCss = `#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: #888;
}
`
    return [
      { path: 'package.json', content: packageJson },
      { path: 'vite.config.js', content: viteConfig },
      { path: 'index.html', content: indexHtml },
      { path: 'public/vite.svg', content: viteSvg },
      { path: 'src/main.jsx', content: mainJsx },
      { path: 'src/App.jsx', content: appJsx },
      { path: 'src/App.css', content: appCss },
      { path: 'src/index.css', content: indexCss },
    ]
  }

  if (type === 'vite-vue') {
    const packageJson = `{
  "name": "${name}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.13"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.3",
    "vite": "^6.3.2"
  }
}
`
    const viteConfigVue = `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
})
`
    const mainJs = `import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

createApp(App).mount('#root')
`
    const styleCss = `:root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`
    const appVue = `<script setup>
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <div>
    <h1>Vite + Vue</h1>
    <div class="card">
      <button type="button" @click="count++">count is {{ count }}</button>
      <p>
        Edit <code>src/App.vue</code> to test HMR
      </p>
    </div>
    <p class="read-the-docs">
      Click on the Vite and Vue logos to learn more
    </p>
  </div>
</template>

<style scoped>
.read-the-docs {
  color: #888;
}
</style>
`
    return [
      { path: 'package.json', content: packageJson },
      { path: 'vite.config.js', content: viteConfigVue },
      { path: 'index.html', content: indexHtml },
      { path: 'public/vite.svg', content: viteSvg },
      { path: 'src/main.js', content: mainJs },
      { path: 'src/App.vue', content: appVue },
      { path: 'src/style.css', content: styleCss },
    ]
  }

  if (type === 'vite-svelte') {
    const packageJson = `{
  "name": "${name}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "svelte": "^5.28.2"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.3",
    "vite": "^6.3.2"
  }
}
`
    const viteConfigSvelte = `import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
})
`
    const mainJs = `import './app.css'
import App from './App.svelte'
import { mount } from 'svelte'

const app = mount(App, {
  target: document.getElementById('root'),
})

export default app
`
    const appCss = `:root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`
    const appSvelte = `<script>
  let count = $state(0)
  function increment() {
    count += 1
  }
</script>

<main>
  <h1>Vite + Svelte</h1>

  <div class="card">
    <button onclick={increment}>
      count is {count}
    </button>
    <p>
      Edit <code>src/App.svelte</code> and save to test HMR
    </p>
  </div>

  <p class="read-the-docs">
    Click on the Vite and Svelte logos to learn more
  </p>
</main>

<style>
  .read-the-docs {
    color: #888;
  }
</style>
`
    return [
      { path: 'package.json', content: packageJson },
      { path: 'vite.config.js', content: viteConfigSvelte },
      { path: 'index.html', content: indexHtml },
      { path: 'public/vite.svg', content: viteSvg },
      { path: 'src/main.js', content: mainJs },
      { path: 'src/App.svelte', content: appSvelte },
      { path: 'src/app.css', content: appCss },
    ]
  }

  // vite-vanilla (default)
  const packageJson = `{
  "name": "${name}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^6.3.2"
  }
}
`
  const mainJs = `import './style.css'

document.querySelector('#app').innerHTML = \`
  <div>
    <h1>Hello Vite!</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite logo to learn more
    </p>
  </div>
\`

document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('#counter').addEventListener('click', () => {
    count = Math.round(count * 10 + 1) / 10
    document.querySelector('#counter').textContent = \`count is \${count}\`
  })
})

let count = 0
`
  const styleCss = `:root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`
  return [
    { path: 'package.json', content: packageJson },
    { path: 'vite.config.js', content: viteConfig },
    { path: 'index.html', content: indexHtml },
    { path: 'public/vite.svg', content: viteSvg },
    { path: 'src/main.js', content: mainJs },
    { path: 'src/style.css', content: styleCss },
  ]
}

// ── scaffold_project ─────────────────────────────────────────────────────────

export function createScaffoldProjectTool(
  onProjectScaffold?: (project: { path: string; name: string; type: DesignProjectType }) => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.scaffold_project,
    inputSchema: zodSchema(z.object({
      type: z.enum(['single-file', 'multiple-files', 'vite-react', 'vite-vue', 'vite-svelte', 'vite-vanilla'])
        .describe('Project type: "single-file" (one HTML with inline CSS/JS), "multiple-files" (separate HTML/CSS/JS), "vite-react" / "vite-vue" / "vite-svelte" / "vite-vanilla" (Vite framework project)'),
      name: z.string().min(1).describe('Project name in snake_case (e.g. "login_page") — used as the directory name'),
    })),
    execute: async ({ type, name }) => {
      console.warn('[scaffold_project] ── START ──')
      console.warn(`[scaffold_project] type=${JSON.stringify(type)} name=${JSON.stringify(name)}`)
      try {
        if (!name || name.trim().length === 0) {
          const msg = 'scaffold_project validation failed: name is required'
          console.warn(`[scaffold_project] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        const designsRoot = await getDesignsRoot()
        const projectPath = await join(designsRoot, name)

        // Create project directory
        await ensureDir(projectPath)

        // For Vite projects, create all necessary files automatically
        let filesCreated = 0
        if (type.startsWith('vite-')) {
          const templateFiles = getViteTemplateFiles(type, name)
          for (const file of templateFiles) {
            const fullPath = await join(projectPath, file.path)
            await write_file(fullPath, file.content)
            filesCreated++
            console.warn(`[scaffold_project] ✓ Created ${file.path}`)
          }
        }

        console.warn(`[scaffold_project] ✓ Project scaffolded at ${projectPath} (${filesCreated} files created)`)

        // Notify callback so the tab can store the project metadata
        onProjectScaffold?.({ path: projectPath, name, type })

        return {
          ok: true,
          path: projectPath,
          type,
          filesCreated,
          message: type.startsWith('vite-')
            ? `Project "${name}" scaffolded at ${projectPath}. Type: ${type}. ${filesCreated} files created automatically. Run build to install dependencies and build.`
            : `Project "${name}" scaffolded at ${projectPath}. Type: ${type}. Now use create_design_files to write the project files.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[scaffold_project] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `scaffold_project failed: ${detail}` }
      }
    },
  })
}

// ── create_design_files ──────────────────────────────────────────────────────

export function createDesignFilesTool(
  getProject?: () => { path: string; name: string; type: DesignProjectType } | null,
  onFilesChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.create_design_files,
    inputSchema: zodSchema(z.object({
      files: z.array(z.object({
        path: z.string().describe('File path relative to project root (e.g. "index.html")'),
        content: z.string().describe('Full file content'),
      })).describe('Array of files to create'),
    })),
    execute: async ({ files }) => {
      console.warn('[create_design_files] ── START ──')
      console.warn(`[create_design_files] files count=${files.length}`)
      try {
        const project = getProject?.()
        if (!project) {
          const msg = 'No active design project. Call scaffold_project first.'
          console.warn(`[create_design_files] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        const results: Array<{ path: string; ok: boolean; error?: string }> = []

        for (const file of files) {
          try {
            const fullPath = await join(project.path, file.path)
            await write_file(fullPath, file.content)
            results.push({ path: file.path, ok: true })
            console.warn(`[create_design_files] ✓ wrote ${file.path} (${file.content.length} bytes)`)
          }
          catch (e) {
            const error = e instanceof Error ? e.message : String(e)
            results.push({ path: file.path, ok: false, error })
            console.warn(`[create_design_files] ✗ failed ${file.path}: ${error}`)
          }
        }

        const allOk = results.every(r => r.ok)
        const failed = results.filter(r => !r.ok)

        if (allOk)
          onFilesChanged?.()

        return {
          ok: allOk,
          filesWritten: results.filter(r => r.ok).length,
          filesFailed: failed.length,
          errors: failed.length > 0 ? failed.map(f => `${f.path}: ${f.error}`) : undefined,
          message: allOk
            ? `${results.length} files written to ${project.name}/`
            : `${results.filter(r => r.ok).length}/${results.length} files written. Failed: ${failed.map(f => f.path).join(', ')}`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[create_design_files] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `create_design_files failed: ${detail}` }
      }
    },
  })
}

// ── edit_design_files ────────────────────────────────────────────────────────

export function createEditDesignFilesTool(
  getProject?: () => { path: string; name: string; type: DesignProjectType } | null,
  onFilesChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.edit_design_files,
    inputSchema: zodSchema(z.object({
      files: z.array(z.object({
        path: z.string().describe('File path relative to project root'),
        content: z.string().describe('New file content'),
        mode: z.enum(['overwrite', 'patch']).describe('"overwrite" replaces entire file; "patch" applies changes (full content provided, diff tracked for logging)'),
      })).describe('Array of files to edit'),
    })),
    execute: async ({ files }) => {
      console.warn('[edit_design_files] ── START ──')
      console.warn(`[edit_design_files] files count=${files.length}`)
      try {
        const project = getProject?.()
        if (!project) {
          const msg = 'No active design project. Call scaffold_project first.'
          console.warn(`[edit_design_files] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        // Stop dev server for Vite projects so it can be restarted with updated files
        if (project.type.startsWith('vite-')) {
          console.warn('[edit_design_files] Stopping dev server for Vite project before edit')
          await stopDevServer(project.path)
        }

        const results: Array<{ path: string; ok: boolean; error?: string }> = []

        for (const file of files) {
          try {
            const fullPath = await join(project.path, file.path)

            // For patch mode, read existing content to log the diff
            if (file.mode === 'patch') {
              try {
                if (await exists(fullPath)) {
                  const existing = await readTextFile(fullPath)
                  if (existing === file.content) {
                    console.warn(`[edit_design_files] ⊘ ${file.path} unchanged, skipping`)
                    results.push({ path: file.path, ok: true })
                    continue
                  }
                }
              }
              catch {
                // File might not exist yet, that's fine — proceed with write
              }
            }

            await write_file(fullPath, file.content)
            results.push({ path: file.path, ok: true })
            console.warn(`[edit_design_files] ✓ ${file.mode} ${file.path} (${file.content.length} bytes)`)
          }
          catch (e) {
            const error = e instanceof Error ? e.message : String(e)
            results.push({ path: file.path, ok: false, error })
            console.warn(`[edit_design_files] ✗ failed ${file.path}: ${error}`)
          }
        }

        const allOk = results.every(r => r.ok)
        const failed = results.filter(r => !r.ok)

        if (allOk)
          onFilesChanged?.()

        return {
          ok: allOk,
          filesEdited: results.filter(r => r.ok).length,
          filesFailed: failed.length,
          errors: failed.length > 0 ? failed.map(f => `${f.path}: ${f.error}`) : undefined,
          message: allOk
            ? `${results.length} files edited in ${project.name}/`
            : `${results.filter(r => r.ok).length}/${results.length} files edited. Failed: ${failed.map(f => f.path).join(', ')}`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[edit_design_files] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `edit_design_files failed: ${detail}` }
      }
    },
  })
}

// ── build_project ────────────────────────────────────────────────────────────

export function createBuildProjectTool(
  getProject?: () => { path: string; name: string; type: DesignProjectType } | null,
  onFilesChanged?: () => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.build_project,
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      console.warn('[build_project] ── START ──')
      try {
        const project = getProject?.()
        if (!project) {
          const msg = 'No active design project. Call scaffold_project first.'
          console.warn(`[build_project] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        // Static HTML types don't need a build step
        if (project.type === 'single-file' || project.type === 'multiple-files') {
          console.warn(`[build_project] ⊘ No build needed for ${project.type}`)
          return {
            ok: true,
            message: 'No build needed for static HTML project. The files render directly.',
          }
        }

        // Vite project — run npm install then npm run build
        console.warn(`[build_project] Running install + build for ${project.type} at ${project.path}`)
        const startTime = Date.now()

        // Step 1: Run npm install
        console.warn('[build_project] Running npm install...')
        const installOutput = await runShellCommand(project.path, 'npm install')

        if (installOutput.code !== 0) {
          const installDurationMs = Date.now() - startTime
          console.warn(`[build_project] ✗ npm install failed (exit ${installOutput.code})`)
          console.warn(`[build_project] stderr: ${installOutput.stderr.slice(0, 500)}`)
          return {
            ok: false,
            errors: installOutput.stderr || installOutput.stdout,
            exitCode: installOutput.code,
            durationMs: installDurationMs,
            message: `npm install failed (exit code ${installOutput.code}). Read the errors and fix.`,
          }
        }

        console.warn('[build_project] npm install succeeded, running build...')

        // Step 2: Run npm run build
        const buildOutput = await runShellCommand(project.path, 'npm run build')
        const durationMs = Date.now() - startTime

        const stdout = buildOutput.stdout
        const stderr = buildOutput.stderr
        const exitCode = buildOutput.code

        if (exitCode === 0) {
          console.warn(`[build_project] ✓ Build succeeded in ${durationMs}ms`)
          onFilesChanged?.()
          return {
            ok: true,
            output: stdout,
            durationMs,
            message: `Build succeeded in ${Math.round(durationMs / 1000)}s. Preview is now available.`,
          }
        }
        else {
          console.warn(`[build_project] ✗ Build failed (exit ${exitCode})`)
          console.warn(`[build_project] stderr: ${stderr.slice(0, 500)}`)
          return {
            ok: false,
            errors: stderr || stdout,
            exitCode,
            durationMs,
            message: `Build failed (exit code ${exitCode}). Read the errors, fix the code, and retry.`,
          }
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[build_project] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `build_project failed: ${detail}` }
      }
    },
  })
}

// ── start_preview ─────────────────────────────────────────────────────────────

export function createStartPreviewTool(
  getProject?: () => { path: string; name: string; type: DesignProjectType } | null,
  onPreviewUrl?: (url: string | null) => void,
  onDevServerTaskId?: (id: string | null) => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.start_preview,
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      console.warn('[start_preview] ── START ──')
      try {
        const project = getProject?.()
        if (!project) {
          const msg = 'No active design project. Call scaffold_project first.'
          console.warn(`[start_preview] ✗ ${msg}`)
          return { ok: false, message: msg }
        }

        // Static HTML projects don't need a dev server
        if (project.type === 'single-file' || project.type === 'multiple-files') {
          console.warn(`[start_preview] ⊘ No dev server needed for ${project.type}`)
          return {
            ok: true,
            message: 'No dev server needed for static HTML project. Files render directly via srcdoc.',
          }
        }

        // Stop any existing dev server for this project
        await stopDevServer(project.path)

        console.warn(`[start_preview] Starting dev server for ${project.type} at ${project.path}`)
        console.warn(`[start_preview] Preferred port: ${DESIGN_PREVIEW_PORT} (Vite auto-increments if busy)`)

        // Ensure dependencies are installed before starting the dev server
        const nodeModulesPath = await join(project.path, 'node_modules')
        if (!(await exists(nodeModulesPath))) {
          console.warn('[start_preview] node_modules not found, running npm install...')
          const installResult = await runShellCommand(project.path, 'npm install')
          if (installResult.code !== 0) {
            const msg = `npm install failed (exit ${installResult.code}): ${installResult.stderr.slice(0, 500)}`
            console.warn(`[start_preview] ✗ ${msg}`)
            return { ok: false, message: msg }
          }
          console.warn('[start_preview] ✓ npm install succeeded')
        }

        // Start npm run dev in the background, passing --port to control the starting port.
        // Vite will auto-increment if the port is already in use (no --strictPort).
        const shell = await resolveShell()
        const devCommand = `npm run dev -- --port ${DESIGN_PREVIEW_PORT}`
        console.warn(`[start_preview] Shell: ${shell}, Command: ${devCommand}`)
        const args = createShellArgs(shell, devCommand)
        console.warn(`[start_preview] Args: ${JSON.stringify(args)}`)
        const command = Command.create(shell, args, { cwd: project.path })

        // Spawn the process first
        const child = await command.spawn()
        console.warn(`[start_preview] Spawned dev server, PID: ${child.pid}`)

        // Store for cleanup
        devServers.set(project.path, { kill: async () => {
          try { await child.kill() }
          catch { /* ignore */ }
        } })

        // Detect the Vite URL asynchronously — don't block the tool call
        // Accumulate from both streams and strip ANSI escape codes before matching.
        // Vite may send "Local: http://..." to stdout OR stderr depending on version.
        let outputBuffer = ''
        const ESC = String.fromCharCode(27)
        const stripAnsi = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')
        const urlPattern = /Local:\s+(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/

        const urlPromise = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            console.warn(`[start_preview] ✗ Timed out after 20s waiting for dev server URL. Buffer: ${outputBuffer.slice(-500)}`)
            reject(new Error('Dev server did not start within 20s'))
          }, 20_000)

          const checkForUrl = (raw: string) => {
            outputBuffer += raw
            const cleaned = stripAnsi(outputBuffer)
            const match = cleaned.match(urlPattern)
            if (match?.[1]) {
              clearTimeout(timeout)
              console.warn(`[start_preview] Detected dev server URL: ${match[1]}`)
              resolve(match[1])
            }
          }

          command.stdout.on('data', (chunk: string) => {
            checkForUrl(chunk)
          })

          command.stderr.on('data', (chunk: string) => {
            checkForUrl(chunk)
          })

          command.on('error', err => {
            clearTimeout(timeout)
            console.warn(`[start_preview] ✗ Process error: ${err}`)
            reject(err)
          })

          command.on('close', event => {
            clearTimeout(timeout)
            if (event.code !== 0) {
              console.warn(`[start_preview] ✗ Dev server exited with code ${event.code}`)
              reject(new Error(`Dev server exited with code ${event.code}`))
            }
          })
        })

        // Fire-and-forget: resolve URL in background, update previewUrl when ready
        urlPromise
          .then(url => {
            console.warn(`[start_preview] ✓ Dev server running at ${url}`)
            onPreviewUrl?.(url)
            onDevServerTaskId?.(`dev-${project.path}`)
          })
          .catch(err => {
            console.warn(`[start_preview] ✗ Failed to detect dev server URL: ${err}`)
            onPreviewUrl?.(null)
          })

        return {
          ok: true,
          message: `Dev server starting on port ${DESIGN_PREVIEW_PORT} (auto-increments if busy). Preview will appear in the canvas shortly.`,
        }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[start_preview] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `start_preview failed: ${detail}` }
      }
    },
  })
}

// ── stop_preview ──────────────────────────────────────────────────────────────

export function createStopPreviewTool(
  getProject?: () => { path: string; name: string; type: DesignProjectType } | null,
  onPreviewUrl?: (url: string | null) => void,
  onDevServerTaskId?: (id: string | null) => void,
) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.stop_preview,
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      console.warn('[stop_preview] ── START ──')
      try {
        const project = getProject?.()
        if (!project) {
          console.warn('[stop_preview] ✗ No active design project')
          return { ok: false, message: 'No active design project.' }
        }

        console.warn(`[stop_preview] Stopping dev server for ${project.name}`)
        await stopDevServer(project.path)
        onPreviewUrl?.(null)
        onDevServerTaskId?.(null)
        console.warn('[stop_preview] ✓ Dev server stopped')
        return { ok: true, message: 'Dev server stopped.' }
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn(`[stop_preview] ✗ EXCEPTION: ${detail}`)
        return { ok: false, message: `stop_preview failed: ${detail}` }
      }
    },
  })
}

// ── Display labels ───────────────────────────────────────────────────────────

export function designProjectToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  if (name === 'scaffold_project') {
    const projectName = typeof args.name === 'string' ? args.name : ''
    const type = typeof args.type === 'string' ? args.type : ''
    return projectName ? `Scaffolding "${projectName}" (${type})` : 'Scaffolding project'
  }
  if (name === 'create_design_files') {
    const files = Array.isArray(args.files) ? args.files : []
    return `Writing ${files.length} file${files.length !== 1 ? 's' : ''}`
  }
  if (name === 'edit_design_files') {
    const files = Array.isArray(args.files) ? args.files : []
    return `Editing ${files.length} file${files.length !== 1 ? 's' : ''}`
  }
  if (name === 'build_project')
    return 'Building project'
  if (name === 'start_preview')
    return 'Starting dev server'
  if (name === 'stop_preview')
    return 'Stopping dev server'
  return `Called ${name}`
}
