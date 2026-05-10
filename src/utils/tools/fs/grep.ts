import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { globToRegex } from './glob'
import { ALWAYS_SKIP, safePath } from './shared'

interface GrepMatch { path: string; line: number; text: string }

async function grepFile(
  absPath: string,
  relPath: string,
  regex: RegExp,
  maxPerFile: number,
  results: GrepMatch[],
): Promise<void> {
  let content: string
  try { content = await readTextFile(absPath) }
  catch { return }
  const lines = content.split('\n')
  let count = 0
  for (let i = 0; i < lines.length && count < maxPerFile; i++) {
    regex.lastIndex = 0
    if (regex.exec(lines[i]!)) {
      results.push({ path: relPath, line: i + 1, text: lines[i]!.trimEnd() })
      count++
    }
  }
}

async function grepWalk(
  absDir: string,
  relDir: string,
  fileRegex: RegExp | null,
  contentRegex: RegExp,
  matches: GrepMatch[],
  maxTotal: number,
  maxPerFile: number,
  showHidden: boolean,
): Promise<void> {
  if (matches.length >= maxTotal)
    return
  let entries: Awaited<ReturnType<typeof readDir>>
  try { entries = await readDir(absDir) }
  catch { return }

  for (const entry of entries) {
    if (!entry.name)
      continue
    if (!showHidden && entry.name.startsWith('.'))
      continue
    if (ALWAYS_SKIP.has(entry.name))
      continue
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = `${absDir}/${entry.name}`
    if (entry.isDirectory) {
      await grepWalk(absPath, relPath, fileRegex, contentRegex, matches, maxTotal, maxPerFile, showHidden)
    }
    else {
      if (fileRegex && !fileRegex.test(entry.name))
        continue
      await grepFile(absPath, relPath, contentRegex, maxPerFile, matches)
      if (matches.length >= maxTotal)
        return
    }
  }
}

export function createGrepTool(projectPath: string) {
  return tool({
    description: `Search file contents using a regular expression.
Returns matching lines with file paths and line numbers.
Use this to find where a function is defined, locate usages, find config values, etc.`,
    inputSchema: z.object({
      pattern: z.string().describe('Regular expression. Standard JS regex syntax. Case-insensitive by default.'),
      path: z.string().optional().describe('Directory or file to search, relative to project root. Default: entire project.'),
      fileGlob: z.string().optional().describe('Restrict to files matching this glob. E.g. "*.ts".'),
      caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: false.'),
      maxResults: z.number().int().min(1).max(1000).optional().describe('Max total matches. Default: 200.'),
      maxPerFile: z.number().int().min(1).max(100).optional().describe('Max matches per file. Default: 20.'),
    }),
    execute: async ({ pattern, path: inputPath = '.', fileGlob, caseSensitive = false, maxResults = 200, maxPerFile = 20 }) => {
      let rootPath: string
      try { rootPath = await safePath(projectPath, inputPath) }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      let contentRegex: RegExp
      try { contentRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi') }
      catch (e) { return { error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` } }

      let fileRegex: RegExp | null = null
      if (fileGlob) {
        try { fileRegex = globToRegex(fileGlob) }
        catch { /* ignore */ }
      }

      const matches: GrepMatch[] = []
      let isFile = false
      try { await readDir(rootPath) }
      catch { isFile = true }

      if (isFile) {
        await grepFile(rootPath, inputPath, contentRegex, maxPerFile, matches)
      }
      else {
        await grepWalk(rootPath, inputPath === '.' ? '' : inputPath, fileRegex, contentRegex, matches, maxResults, maxPerFile, false)
      }

      const lines: string[] = []
      let lastPath = ''
      for (const m of matches) {
        if (m.path !== lastPath) {
          if (lastPath)
            lines.push('')
          lines.push(`${m.path}:`)
          lastPath = m.path
        }
        lines.push(`  ${String(m.line).padStart(4)} │ ${m.text}`)
      }

      return {
        pattern,
        totalMatches: matches.length,
        filesWithMatches: new Set(matches.map(m => m.path)).size,
        result: lines.join('\n') || '(no matches)',
        ...(matches.length >= maxResults ? { note: `Results capped at ${maxResults}.` } : {}),
      }
    },
  })
}
