import type { ScaffoldOptions, ScaffoldTemplate } from './templates'
import { Command } from '@tauri-apps/plugin-shell'

export interface ScaffoldExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

export interface ShellResolution {
  program: 'powershell' | 'sh'
  args: string[]
}

let cachedShell: ShellResolution | null = null

export function resolveShell(): ShellResolution {
  if (cachedShell)
    return cachedShell

  const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
  cachedShell = isWindows
    ? { program: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'] }
    : { program: 'sh', args: ['-lc'] }

  return cachedShell
}

function shellQuote(value: string, program: ShellResolution['program']) {
  if (value === '')
    return "''"

  if (program === 'powershell')
    return `'${value.replace(/'/g, "''")}'`

  return `'${value.replace(/'/g, "'\\''")}'`
}

function toText(chunk: unknown): string {
  if (typeof chunk === 'string')
    return chunk
  if (chunk instanceof Uint8Array)
    return new TextDecoder().decode(chunk)
  if (Array.isArray(chunk))
    return chunk.map(item => toText(item as unknown)).join('')
  return String(chunk ?? '')
}

function rewriteCommandForPackageManager(command: string, packageManager: string) {
  const pm = String(packageManager || 'npm')
  if (pm === 'npm')
    return command

  const normalized = command.trim()

  if (/^npm\s+create\s+/i.test(normalized)) {
    const suffix = normalized.replace(/^npm\s+create\s+/i, '')
    if (pm === 'pnpm')
      return `pnpm create ${suffix}`
    if (pm === 'yarn')
      return `yarn create ${suffix}`
    if (pm === 'bun')
      return `bun create ${suffix}`
    if (pm === 'deno')
      return 'deno run -A npm:create-vite'
  }

  if (/^npx(?:\s+-y)?\s+/i.test(normalized)) {
    const suffix = normalized.replace(/^npx(?:\s+-y)?\s+/i, '')
    if (pm === 'pnpm')
      return `pnpm dlx ${suffix}`
    if (pm === 'yarn')
      return `yarn dlx ${suffix}`
    if (pm === 'bun')
      return `bunx ${suffix}`
    if (pm === 'deno')
      return `deno run -A npm:${suffix}`
  }

  if (/^npm\s+exec\s+/i.test(normalized)) {
    const suffix = normalized.replace(/^npm\s+exec\s+/i, '')
    if (pm === 'pnpm')
      return `pnpm dlx ${suffix}`
    if (pm === 'yarn')
      return `yarn dlx ${suffix}`
    if (pm === 'bun')
      return `bunx ${suffix}`
    if (pm === 'deno')
      return `deno run -A npm:${suffix}`
  }

  return command
}

export function withPackageManager(command: string, options: ScaffoldOptions) {
  const pm = String(options.packageManager || 'npm')
  return rewriteCommandForPackageManager(command, pm)
}

export function buildCommandLine(
  template: ScaffoldTemplate,
  projectName: string,
  options: ScaffoldOptions,
) {
  const baseCommand = withPackageManager(template.command, options)
  const parts = [baseCommand, ...template.args(projectName, options)]
  return parts
    .flatMap((part, index) => {
      if (index === 0)
        return [part]
      return [shellQuote(String(part), resolveShell().program)]
    })
    .join(' ')
}

export async function runScaffold(
  template: ScaffoldTemplate,
  projectName: string,
  options: ScaffoldOptions,
  cwd: string,
  onOutput?: (kind: 'stdout' | 'stderr' | 'system', line: string) => void,
): Promise<ScaffoldExecutionResult> {
  const shell = resolveShell()
  const commandLine = buildCommandLine(template, projectName, options)
  const command = Command.create(shell.program, [...shell.args, commandLine], {
    cwd,
    encoding: 'utf-8',
  })

  const startedAt = performance.now()
  let stdout = ''
  let stderr = ''
  let settled = false

  const cleanup = () => {
    command.removeAllListeners?.()
    command.stdout.removeAllListeners?.()
    command.stderr.removeAllListeners?.()
  }

  return await new Promise<ScaffoldExecutionResult>((resolve, reject) => {
    command.on('error', (error: unknown) => {
      if (settled)
        return
      settled = true
      cleanup()
      const message = error instanceof Error ? error.message : String(error)
      reject(new Error(message))
    })

    command.on('close', (payload: { code: number | null; signal: number | null }) => {
      if (settled)
        return
      settled = true
      cleanup()
      resolve({
        success: payload.code === 0,
        stdout,
        stderr,
        exitCode: payload.code,
        durationMs: Math.round(performance.now() - startedAt),
      })
    })

    command.stdout.on('data', chunk => {
      const line = toText(chunk)
      stdout += line
      onOutput?.('stdout', line)
    })

    command.stderr.on('data', chunk => {
      const line = toText(chunk)
      stderr += line
      onOutput?.('stderr', line)
    })

    command.spawn().then(() => {
      onOutput?.('system', `> ${commandLine}`)
    }).catch(error => {
      if (settled)
        return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export function joinPath(parentDir: string, childName: string) {
  const trimmedParent = parentDir.replace(/[\\/]+$/, '')
  const trimmedChild = childName.replace(/^[\\/]+/, '')
  const sep = trimmedParent.includes('\\') && !trimmedParent.includes('/') ? '\\' : '/'
  return `${trimmedParent}${sep}${trimmedChild}`
}

export function sanitizeProjectName(input: string) {
  const value = input.trim()
  if (!value)
    return ''

  if (/[\\/]/.test(value))
    return ''
  if (/^\.+$/.test(value))
    return ''
  if (/[:*?"<>|]/.test(value))
    return ''
  return value
}
