import { readDir } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { safePath, shouldSkipEntry } from './shared'

/** Simple glob-to-regex converter for ignore patterns. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

function matchesIgnore(name: string, ignorePatterns: RegExp[]): boolean {
  return ignorePatterns.some(re => re.test(name))
}

function formatListing(
  entries: { name: string; type: 'dir' | 'file' | 'symlink' }[],
  basePath: string,
): string {
  if (entries.length === 0)
    return '(empty directory)'
  const dirs = entries.filter(e => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter(e => e.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const lines = [`Directory: ${basePath}`, '']
  for (const d of dirs) lines.push(`  📁 ${d.name}/`)
  for (const f of files) lines.push(`  📄 ${f.name}`)
  return lines.join('\n')
}

export function createListDirectoryTool(projectPath: string) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.list_directory,
    inputSchema: z.object({
      path: z.string().describe('The absolute path to the directory to list (must be absolute, not relative)'),
      ignore: z.array(z.string()).optional().describe('List of glob patterns to ignore'),
    }),
    execute: async ({ path: inputPath, ignore }) => {
      let resolvedPath: string
      try {
        resolvedPath = await safePath(projectPath, inputPath, { kind: 'list' })
      }
      catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }

      let raw: Awaited<ReturnType<typeof readDir>>
      try { raw = await readDir(resolvedPath) }
      catch (e) { return { error: `Cannot read "${inputPath}": ${e instanceof Error ? e.message : String(e)}` } }

      const ignorePatterns = (ignore ?? []).map(globToRegex)

      const entries = raw
        .filter(e => e.name && !shouldSkipEntry(e.name, true) && !matchesIgnore(e.name, ignorePatterns))
        .map(e => ({
          name: e.name!,
          type: e.isDirectory ? 'dir' as const : e.isSymlink ? 'symlink' as const : 'file' as const,
        }))

      return { result: formatListing(entries, resolvedPath), count: entries.length }
    },
  })
}
