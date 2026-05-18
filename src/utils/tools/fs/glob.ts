import { readDir } from '@tauri-apps/plugin-fs'
import { tool } from 'ai'
import { z } from 'zod'
import { ALWAYS_SKIP, safePath } from './shared'

export function globToRegex(pattern: string): RegExp {
  let src = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (pattern.slice(i, i + 2) === '**') {
      src += '.*'
      i += 2
      if (pattern[i] === '/')
        i++
    }
    else if (ch === '*') {
      src += '[^/]*'
      i++
    }
    else if (ch === '?') {
      src += '[^/]'
      i++
    }
    else if (ch === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) {
        src += '\\{'
        i++
        continue
      }
      const alts = pattern.slice(i + 1, end).split(',').map(a =>
        a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'),
      )
      src += `(?:${alts.join('|')})`
      i = end + 1
    }
    else if (ch === '[') {
      const end = pattern.indexOf(']', i)
      if (end === -1) {
        src += '\\['
        i++
        continue
      }
      src += pattern.slice(i, end + 1)
      i = end + 1
    }
    else {
      src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  src += '$'
  return new RegExp(src, 'i')
}

async function globWalk(
  absDir: string,
  relDir: string,
  regex: RegExp,
  results: string[],
  maxResults: number,
  showHidden: boolean,
): Promise<void> {
  if (results.length >= maxResults)
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
      await globWalk(absPath, relPath, regex, results, maxResults, showHidden)
    }
    else if (regex.test(relPath)) {
      results.push(relPath)
      if (results.length >= maxResults)
        return
    }
  }
}

export function createGlobTool(projectPath: string) {
  return tool({
    description: 'Find files by glob pattern. Supports *, **, ?, {a,b}, [abc]. Build artifacts (node_modules, dist, .git, etc.) always excluded. Use when you need to locate files without knowing their exact path.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern relative to project root. E.g. "**/*.ts", "src/**/*.vue"'),
      maxResults: z.number().int().min(1).max(500).optional().describe('Max results. Default: 100.'),
      showHidden: z.boolean().optional().describe('Include dotfiles. Default: false.'),
    }),
    execute: async ({ pattern, maxResults = 100, showHidden = false }) => {
      let rootPath: string
      try { rootPath = await safePath(projectPath, '.') }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      let regex: RegExp
      try { regex = globToRegex(pattern) }
      catch (e) { return { error: `Invalid glob pattern: ${e instanceof Error ? e.message : String(e)}` } }

      const matches: string[] = []
      await globWalk(rootPath, '', regex, matches, maxResults, showHidden)
      const truncated = matches.length === maxResults
      return {
        pattern,
        matches,
        count: matches.length,
        ...(truncated ? { note: `Results capped at ${maxResults}. Use a more specific pattern.` } : {}),
      }
    },
  })
}
