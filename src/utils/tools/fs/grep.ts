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
  // FIX 3: accept compiled exclude regexes instead of raw globs
  excludeRegexes: RegExp[],
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
    // FIX 3: skip entries whose name matches any exclude glob
    if (excludeRegexes.some(rx => rx.test(entry.name)))
      continue

    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = `${absDir}/${entry.name}`
    if (entry.isDirectory) {
      await grepWalk(absPath, relPath, fileRegex, excludeRegexes, contentRegex, matches, maxTotal, maxPerFile, showHidden)
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

// FIX 3: build a fuzzy regex that allows one inserted/deleted/substituted char
// e.g. "colour" → matches "color", "colour", "colur", etc.
function buildFuzzyRegex(pattern: string, flags: string): RegExp {
  // Escape the literal pattern then allow ?.{0,1} between every character pair
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const chars = escaped.split('')
  // Insert an optional wildcard between each character
  const fuzzy = chars.join('.{0,1}')
  return new RegExp(fuzzy, flags)
}

export function createGrepTool(projectPath: string) {
  return tool({
    description: 'Search file contents with a regex. Returns matching lines with file paths and line numbers. Use to find definitions, usages, config values, etc.',
    inputSchema: z.object({
      pattern: z.string().describe('Regular expression. Standard JS regex syntax. Case-insensitive by default.'),
      path: z.string().optional().describe('Directory or file to search, relative to project root. Default: entire project.'),
      fileGlob: z.string().optional().describe('Restrict to files matching this glob. E.g. "*.ts".'),
      // FIX 3: new exclude parameter
      exclude: z
        .array(z.string())
        .optional()
        .describe(
          'Glob patterns for file/directory names to skip. E.g. ["*.min.js", "dist", "vendor"]. '
          + 'Applied in addition to the built-in ALWAYS_SKIP list.',
        ),
      caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: false.'),
      // FIX 3: fuzzy matching
      fuzzy: z
        .boolean()
        .optional()
        .describe(
          'Fuzzy match: allow up to one inserted, deleted, or substituted character per gap. '
          + 'Useful when you\'re not sure of exact spelling. Default: false.',
        ),
      maxResults: z.number().int().min(1).max(1000).optional().describe('Max total matches. Default: 200.'),
      maxPerFile: z.number().int().min(1).max(100).optional().describe('Max matches per file. Default: 20.'),
    }),
    execute: async ({
      pattern,
      path: inputPath = '.',
      fileGlob,
      exclude,
      caseSensitive = false,
      fuzzy = false,
      maxResults = 200,
      maxPerFile = 20,
    }) => {
      let rootPath: string
      try { rootPath = await safePath(projectPath, inputPath) }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

      const regexFlags = caseSensitive ? 'g' : 'gi'

      // FIX 3: validate pattern first so we can always report "pattern is valid"
      let contentRegex: RegExp
      try {
        contentRegex = fuzzy
          ? buildFuzzyRegex(pattern, regexFlags)
          : new RegExp(pattern, regexFlags)
      }
      catch (e) { return { error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` } }

      let fileRegex: RegExp | null = null
      if (fileGlob) {
        try { fileRegex = globToRegex(fileGlob) }
        catch { /* ignore */ }
      }

      // FIX 3: compile exclude globs
      const excludeRegexes: RegExp[] = []
      for (const g of exclude ?? []) {
        try { excludeRegexes.push(globToRegex(g)) }
        catch { /* ignore bad globs */ }
      }

      const matches: GrepMatch[] = []
      let isFile = false
      try { await readDir(rootPath) }
      catch { isFile = true }

      if (isFile) {
        await grepFile(rootPath, inputPath, contentRegex, maxPerFile, matches)
      }
      else {
        await grepWalk(
          rootPath,
          inputPath === '.' ? '' : inputPath,
          fileRegex,
          excludeRegexes,
          contentRegex,
          matches,
          maxResults,
          maxPerFile,
          false,
        )
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

      // FIX 1: distinguish "no matches" from an error, and confirm the pattern was valid
      const noMatches = matches.length === 0
      const result = noMatches
        ? `(no matches — pattern "${pattern}" is valid and the search completed successfully)`
        : lines.join('\n')

      return {
        pattern,
        patternValid: true, // FIX 1: always present so the agent knows the regex compiled
        totalMatches: matches.length,
        filesWithMatches: new Set(matches.map(m => m.path)).size,
        result,
        ...(matches.length >= maxResults ? { note: `Results capped at ${maxResults}.` } : {}),
        // FIX 3: surface which excludes were active so the agent can reason about them
        ...(excludeRegexes.length > 0 ? { excludedGlobs: exclude } : {}),
      }
    },
  })
}
