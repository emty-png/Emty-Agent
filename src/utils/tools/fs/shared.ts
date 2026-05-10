import { join, normalize } from '@tauri-apps/api/path'
import { mkdir } from '@tauri-apps/plugin-fs'

export const ALWAYS_SKIP = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'target',
  '.cargo',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  'tmp',
  '.tmp',
  'temp',
  '.turbo',
  '.vercel',
])

export function shouldSkipEntry(name: string, showHidden: boolean): boolean {
  if (ALWAYS_SKIP.has(name))
    return true
  if (!showHidden && name.startsWith('.'))
    return true
  return false
}

export async function safePath(projectPath: string, inputPath: string): Promise<string> {
  const full = await join(projectPath, inputPath)
  const normalFull = await normalize(full)
  const normalProject = await normalize(projectPath)
  const sep = normalProject.includes('\\') ? '\\' : '/'
  const projectDir = normalProject.endsWith(sep) ? normalProject : normalProject + sep
  if (normalFull !== normalProject && !normalFull.startsWith(projectDir)) {
    throw new Error(`Access denied: "${inputPath}" resolves outside the project directory`)
  }
  return normalFull
}

export async function ensureDir(absoluteDirPath: string): Promise<void> {
  try {
    await mkdir(absoluteDirPath, { recursive: true })
    return
  }
  catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase()
    if (
      msg.includes('already exists')
      || msg.includes('file exists')
      || msg.includes('os error 17')
      || msg.includes('os error 183')
    ) {
      return
    }
  }

  const sep = absoluteDirPath.includes('\\') ? '\\' : '/'
  const segments = absoluteDirPath.split(sep)
  let current = ''

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    current = i === 0 ? seg : `${current}${sep}${seg}`
    if (!current)
      continue

    try {
      await mkdir(current)
    }
    catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase()
      const raw = e instanceof Error ? e.message : String(e)
      if (
        msg.includes('already exists')
        || msg.includes('file exists')
        || msg.includes('os error 17')
        || msg.includes('os error 183')
      ) {
        continue
      }
      throw new Error(`Cannot create directory "${current}": ${raw}`)
    }
  }
}

/**
 * Optional callback invoked BEFORE any file mutation so the checkpoint
 * system can capture the file's pre-mutation content.
 */
export type BeforeFileWriteCallback = (
  relativePath: string,
  absolutePath: string,
) => Promise<void>
