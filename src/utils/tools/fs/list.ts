import { readDir } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { safePath, shouldSkipEntry } from './shared'

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
    description: 'List files and directories in a project folder. Build artifacts (node_modules, dist, .git, etc.) skipped by default. Call this before making assumptions about project structure.',
    inputSchema: z.object({
      path: z.string().describe('Directory path relative to the project root. Use "." for root.'),
      showHidden: z.boolean().optional().describe('Include dotfiles/dotdirs. Default: false.'),
    }),
    execute: async ({ path: inputPath, showHidden = false }) => {
      let fullPath: string
      try { fullPath = await safePath(projectPath, inputPath) }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      let raw: Awaited<ReturnType<typeof readDir>>
      try { raw = await readDir(fullPath) }
      catch (e) { return { error: `Cannot read "${inputPath}": ${e instanceof Error ? e.message : String(e)}` } }

      const entries = raw
        .filter(e => e.name && !shouldSkipEntry(e.name, showHidden))
        .map(e => ({
          name: e.name!,
          type: e.isDirectory ? 'dir' as const : e.isSymlink ? 'symlink' as const : 'file' as const,
        }))

      return { result: formatListing(entries, inputPath), count: entries.length }
    },
  })
}
