/**
 * src/utils/tools/shellMutations.ts
 *
 * Extracts the file paths a shell command is likely to mutate, so the
 * checkpoint system can snapshot their pre-mutation state before
 * `run_command` executes.
 *
 * The parser is intentionally conservative — it catches the common
 * mutation patterns without trying to be a full POSIX shell parser.
 * For complex pipelines, package managers, or build tools the
 * snapshot is best-effort; callers can still rely on the explicit
 * filesystem tool snapshots for critical files.
 *
 * Scope:
 *   • Redirections: >, >>, 2>, 2>>, &>, &>>, >|
 *   • sed -i [-E] [-e SCRIPT]... [SCRIPT] FILE...
 *   • rm [-rRf] FILE...
 *   • mv [-fn] SRC DST
 *   • cp [-rn] SRC... DST
 *   • touch [-a] [-m] [-t STAMP] FILE...
 *   • tee [-a] FILE...
 *   • truncate [-s SIZE] FILE...
 *   • dd [if=...] of=FILE
 *   • git checkout [--] FILE...
 *   • git checkout <ref> [--] FILE...
 *   • git restore [--source=...] FILE...
 *
 * Skipped (hard to predict deterministically):
 *   • find, xargs, tar, zip, unzip, make, curl, wget
 *   • package managers: pnpm, npm, yarn, bun, cargo, go
 *   • command paths that shadow builtins (e.g. /usr/bin/rm still works)
 *   • shell aliases / functions defined in rc files
 *   • pipelines where the producer's stdout is consumed internally
 *
 * Glob expansion supports `*` and `?` against a single directory level
 * (no `**` recursion). Expansion is capped to MAX_GLOB_RESULTS entries
 * to keep the parser cheap on adversarial commands.
 */

import { exists, readDir } from '@tauri-apps/plugin-fs'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ShellMutationTarget {
  /** Absolute path on disk. */
  absolutePath: string
  /** Path relative to the project root (forward slashes, lowercase-insensitive). */
  relativePath: string
  /** Human-readable description of why this file was matched. */
  reason: string
}

export interface MutationParserOptions {
  /** Working directory the command is interpreted against. */
  cwd: string
  /** Project root used to filter targets and compute the relative path. */
  projectPath: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_GLOB_RESULTS = 200

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.parcel-cache',
  'coverage',
  'target',
  'out',
  '.svelte-kit',
  '.output',
  '.vercel',
  '.expo',
  'vendor',
  '__pycache__',
  '.pnpm-store',
  '.gradle',
  '.idea',
  '.vscode',
  'Pods',
  'DerivedData',
  'cmake-build-debug',
  'cmake-build-release',
  '.angular',
  '.astro',
  '.tanstack',
])

// ---------------------------------------------------------------------------
// Command segmentation
// ---------------------------------------------------------------------------

/**
 * Split a compound command into top-level segments separated by
 * `;`, `|`, `&&`, `||`. Respects single/double quotes and skips
 * parentheses that belong to subshells or process substitution.
 */
export function parseShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  const parenDepth = 0
  let i = 0

  while (i < command.length) {
    const ch = command[i]!

    if (quote != null) {
      current += ch
      if (ch === quote)
        quote = null
      i++
      continue
    }

    if (ch === '"' || ch === '\'') {
      quote = ch
      current += ch
      i++
      continue
    }

    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1]!
      i += 2
      continue
    }

    if (ch === '(' || ch === ')') {
      // Only treat as a subshell paren at top level (parenDepth === 0).
      // Inside, the whole $(...) block is opaque to us.
      if (ch === '(' && parenDepth === 0) {
        // Subshell start — consume until matching paren
        let depth = 1
        current += ch
        i++
        while (i < command.length && depth > 0) {
          const c = command[i]!
          if (c === '"' || c === '\'') {
            current += c
            i++
            while (i < command.length && command[i] !== c) {
              current += command[i]!
              i++
            }
            if (i < command.length) {
              current += command[i]!
              i++
            }
            continue
          }
          if (c === '\\' && i + 1 < command.length) {
            current += c + command[i + 1]!
            i += 2
            continue
          }
          if (c === '(')
            depth++
          else if (c === ')')
            depth--
          current += c
          i++
        }
        continue
      }
      // Close paren at top level — treat as terminator
      if (ch === ')' && parenDepth === 0) {
        current += ch
        i++
        continue
      }
    }

    // Check for `&&` or `||`
    if ((ch === '&' || ch === '|') && i + 1 < command.length && command[i + 1] === ch) {
      if (current.trim().length > 0)
        segments.push(current.trim())
      current = ''
      i += 2
      continue
    }

    // Single `;` or `|` (pipe) is a separator; `&` alone is also a separator
    if (ch === ';' || ch === '|' || ch === '&') {
      if (current.trim().length > 0)
        segments.push(current.trim())
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  if (current.trim().length > 0)
    segments.push(current.trim())

  return segments
}

// ---------------------------------------------------------------------------
// Shell-style argument splitter
// ---------------------------------------------------------------------------

/**
 * Tokenize a string into shell-like args, respecting single/double
 * quotes and backslash escapes. Used to inspect segment args after
 * segmentation.
 */
export function splitShellArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaping = false

  for (const ch of input) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }

    if (ch === '\\' && quote !== '\'') {
      escaping = true
      continue
    }

    if (quote != null) {
      if (ch === quote)
        quote = null
      else
        current += ch
      continue
    }

    if (ch === '"' || ch === '\'') {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (escaping)
    current += '\\'
  if (current.length > 0)
    tokens.push(current)

  return tokens
}

/**
 * Identify the base command of a segment (after env var assignments
 * like `FOO=bar cmd`). Returns the lowercased basename of the
 * command, or null if the segment is empty.
 */
export function identifyBaseCommand(segment: string): string | null {
  const tokens = splitShellArgs(segment.trim())
  if (tokens.length === 0)
    return null

  let idx = 0
  while (idx < tokens.length) {
    const tok = tokens[idx]!
    // env var assignment: NAME=value (not `name=value cmd` form, just bare prefix)
    if (/^[A-Z_]\w*=/i.test(tok)) {
      idx++
      continue
    }
    // `command` builtin — skip it
    if (tok === 'command' && idx + 1 < tokens.length) {
      idx++
      continue
    }
    const basename = tok.split(/[\\/]/).pop() ?? tok
    return basename.toLowerCase()
  }

  return null
}

// ---------------------------------------------------------------------------
// Redirect extraction
// ---------------------------------------------------------------------------

const REDIRECT_OUTPUT_RE
  = /(?:^|[\s;|])(&>>|&>|2>>|2>|>>|>\||>)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g

/**
 * Strip heredoc bodies (`<<EOF ... EOF`) and herestrings (`<<< word`)
 * and process substitutions (`<(...)` / `>(...)`)
 */
function stripHeredocsAndSubs(segment: string): string {
  const lines = segment.split('\n')
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const openMatch = line?.match(/^(\s*)<<-?\s*['"]?(\w+)['"]?/)
    if (openMatch) {
      const delimiter = openMatch[2]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const closeRe = new RegExp(`^\\s*${delimiter}\\s*(?=$|[;|])`)
      i++
      while (i < lines.length) {
        if (closeRe.test(lines[i]!)) {
          i++
          break
        }
        i++
      }
      result.push(`${openMatch[1]} `)
    }
    else {
      result.push(line!)
      i++
    }
  }
  return result.join('\n')
}

/**
 * Extract file paths that are the target of output redirects (`>`,
 * `>>`, `2>`, `2>>`, `&>`, `&>>`, `>|`). Skips input redirects,
 * dup operators, and `/dev/*` special paths.
 */
export function extractRedirectTargets(segment: string): string[] {
  // Strip heredoc bodies (<<EOF ... EOF) and herestrings (<<< word)
  // and process substitutions (<(...) / >(...))
  let cleaned = stripHeredocsAndSubs(segment)
  cleaned = cleaned.replace(/<<<\s*[^\n]+/g, ' ')
  cleaned = cleaned.replace(/[<>]\([^)]*\)/g, ' ')

  const out: string[] = []
  REDIRECT_OUTPUT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  m = REDIRECT_OUTPUT_RE.exec(cleaned)
  while (m !== null) {
    const op = m[2] ?? ''
    const target = m[3] ?? ''

    // Skip input redirects (defensive — regex shouldn't allow them)
    if (op.startsWith('<'))
      continue
    // Skip dup redirects where the RHS is a number or `-` (e.g. 2>&1, 1>&2)
    if (/^\d+$/.test(target) || target === '-')
      continue
    // Skip /dev/* special paths
    if (target.startsWith('/dev/'))
      continue

    out.push(stripQuotes(target))
    m = REDIRECT_OUTPUT_RE.exec(cleaned)
  }

  return out
}

// ---------------------------------------------------------------------------
// Per-command extractors
// ---------------------------------------------------------------------------

/** Skip a leading run of option tokens (anything starting with `-`). */
function takeFileArgsFrom(tokens: string[]): { fileArgs: string[]; i: number } {
  const fileArgs: string[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok.startsWith('-') && tok !== '-')
      i++
    else
      break
  }
  while (i < tokens.length) {
    fileArgs.push(tokens[i]!)
    i++
  }
  return { fileArgs, i }
}

/**
 * sed -i [--follow-symlinks] [-e SCRIPT]... [SCRIPT] FILE...
 * Returns the FILE... portion. Skips when -i/--in-place is absent.
 */
export function extractSedFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return []
  // tokens[0] is the command name
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'sed')
    return []

  const flags: string[] = []
  const positional: string[] = []
  let i = 1
  // Collect options and their inline values
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (!tok.startsWith('-') || tok === '-')
      break
    if (tok === '-e' || tok === '--expression' || tok === '-f' || tok === '--file') {
      flags.push(tok)
      i++
      if (i < tokens.length) {
        flags.push(tokens[i]!)
        i++
      }
      continue
    }
    if (tok.startsWith('--expression=') || tok.startsWith('--file=')) {
      flags.push(tok)
      i++
      continue
    }
    // -i[bak], --in-place[=bak], other options
    flags.push(tok)
    i++
  }
  // Anything before FILEs is the implicit script (if -e/-f weren't used)
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok.startsWith('-') && tok !== '-')
      break
    positional.push(tok)
    i++
  }

  const hasInPlace = flags.some(f =>
    f === '-i'
    || f === '--in-place'
    || f === '--follow-symlinks'
    || f === '--copy'
    || /^-i\.[A-Za-z0-9]+$/.test(f)
    || f.startsWith('--in-place='))
  if (!hasInPlace)
    return []

  // File args are everything in `positional` after the implicit script
  // (and after any -e/-f script tokens, which we already consumed).
  // The implicit script is the first positional entry when -e/-f were not used.
  const usedEorF = flags.some(f => f === '-e' || f === '--expression' || f === '-f' || f === '--file')
  if (usedEorF)
    return positional
  return positional.slice(1)
}

/** rm [-rRf] FILE... */
export function extractRmFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return []
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'rm')
    return []

  return takeFileArgsFrom(tokens.slice(1)).fileArgs
}

/**
 * mv [-fn] SRC DST  (exactly two positional args after options).
 * Returns both src and dst — restore must re-create src and roll back dst.
 */
export function extractMvTargets(segment: string): { src: string; dst: string } | null {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return null
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'mv')
    return null

  const { fileArgs } = takeFileArgsFrom(tokens.slice(1))
  if (fileArgs.length !== 2)
    return null
  return { src: fileArgs[0]!, dst: fileArgs[1]! }
}

/**
 * cp [-rn] SRC... DST  (last positional arg is the dst directory or file).
 * Returns all srcs (read-only, no snapshot needed) and the dst.
 */
export function extractCpTargets(segment: string): { src: string[]; dst: string } | null {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return null
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'cp')
    return null

  const { fileArgs } = takeFileArgsFrom(tokens.slice(1))
  if (fileArgs.length < 2)
    return null
  return { src: fileArgs.slice(0, -1), dst: fileArgs[fileArgs.length - 1]! }
}

/** touch [-am] [-t STAMP] [-d DATE] FILE... */
export function extractTouchFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return []
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'touch')
    return []

  // touch has option-with-arg flags: -t, -d, --time, --date
  const valueOptions = new Set(['-t', '-d', '--time', '--date', '--reference', '-r'])
  const fileArgs: string[] = []
  let i = 1
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (!tok.startsWith('-') || tok === '-') {
      fileArgs.push(tok)
      i++
      continue
    }
    if (valueOptions.has(tok) || tok.startsWith('--time=') || tok.startsWith('--date=') || tok.startsWith('--reference=')) {
      i++
      if (i < tokens.length)
        i++ // skip the value
      continue
    }
    i++
  }
  return fileArgs
}

/** tee [-a] FILE... (read from stdin, write to FILE...) */
export function extractTeeFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return []
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'tee')
    return []

  return takeFileArgsFrom(tokens.slice(1)).fileArgs
}

/** truncate [-s SIZE] [-o] FILE... */
export function extractTruncateFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return []
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'truncate')
    return []

  const valueOptions = new Set(['-s', '--size', '-o', '--io-blocks', '-r', '--reference'])
  const fileArgs: string[] = []
  let i = 1
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (!tok.startsWith('-') || tok === '-') {
      fileArgs.push(tok)
      i++
      continue
    }
    if (valueOptions.has(tok)) {
      i++
      if (i < tokens.length)
        i++
      continue
    }
    if (tok.startsWith('--size=') || tok.startsWith('--io-blocks=') || tok.startsWith('--reference=')) {
      i++
      continue
    }
    i++
  }
  return fileArgs
}

/**
 * dd OPERAND...  — extract of= and (for reference) if= paths.
 * Only `of=` triggers a snapshot (the output side).
 */
export function extractDdFile(segment: string): string | null {
  const tokens = splitShellArgs(segment)
  if (tokens.length === 0)
    return null
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'dd')
    return null

  for (const tok of tokens.slice(1)) {
    if (tok.startsWith('of='))
      return stripQuotes(tok.slice(3))
  }
  return null
}

/**
 * git checkout [--] FILE...  OR  git checkout <ref> [--] FILE...
 * Returns the FILE... portion. Exits early if the segment doesn't match
 * the checkout-with-files form.
 */
export function extractGitCheckoutFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length < 2)
    return []
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'git')
    return []
  if ((tokens[1] ?? '').toLowerCase() !== 'checkout')
    return []

  // Find the `--` separator; everything after is files
  const dashIdx = tokens.indexOf('--', 2)
  if (dashIdx !== -1)
    return tokens.slice(dashIdx + 1)

  // No `--` — could still be `git checkout <ref> FILE...` where the
  // last arg is a file and the others form the ref. Be conservative:
  // only treat as files if there are at least 2 non-option args and the
  // last one doesn't look like a ref (refs are branches/tags/commits —
  // hard to disambiguate from filenames). Default: skip if ambiguous.
  const tail = tokens.slice(2)
  if (tail.length < 2)
    return []

  // If all args are options, no files
  if (tail.every(t => t.startsWith('-')))
    return []

  // Assume the last arg is a file and everything before it is a ref.
  // This is the common form: `git checkout main -- file` (with explicit
  // dash) is more reliable, but the bare form `git checkout main file`
  // also works. We snapshot the file.
  return tail.slice(-1)
}

/** git restore [--source=...] [--staged] FILE... */
export function extractGitRestoreFiles(segment: string): string[] {
  const tokens = splitShellArgs(segment)
  if (tokens.length < 2)
    return []
  if ((tokens[0]?.split(/[\\/]/).pop() ?? '').toLowerCase() !== 'git')
    return []
  if ((tokens[1] ?? '').toLowerCase() !== 'restore')
    return []

  // Only --source/-s take a value; --staged, --worktree, --patch, etc. are
  // boolean flags and must NOT consume the next token.
  const valueOptions = new Set(['-s', '--source'])
  const fileArgs: string[] = []
  let i = 2
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (!tok.startsWith('-') || tok === '-') {
      fileArgs.push(tok)
      i++
      continue
    }
    if (valueOptions.has(tok)) {
      i++
      if (i < tokens.length)
        i++
      continue
    }
    if (tok.startsWith('--source=')) {
      i++
      continue
    }
    // Other boolean flag — skip without consuming the next token
    i++
  }
  return fileArgs
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/** Convert any path to forward-slash form and collapse `./` and `//`. */
export function normalizePath(p: string): string {
  const forward = p.replace(/\\/g, '/')
  const isAbsolute = forward.startsWith('/')
  const hasDrive = /^[A-Z]:/i.test(forward)
  const drive = hasDrive ? forward.slice(0, 2) : ''
  const rest = hasDrive ? forward.slice(2) : forward

  const segments = rest.split('/').filter(Boolean)
  const parts: string[] = []
  for (const seg of segments) {
    if (seg === '.')
      continue
    if (seg === '..') {
      if (parts.length > 0)
        parts.pop()
      continue
    }
    parts.push(seg)
  }

  const joined = parts.join('/')
  if (hasDrive)
    return drive + (joined ? `/${joined}` : '')
  if (isAbsolute)
    return `/${joined}`
  return joined
}

/** True when `absolute` equals `base` or sits under `base`. Case-insensitive. */
export function isWithinPath(absolute: string, base: string): boolean {
  const a = normalizePath(absolute).toLowerCase()
  const b = normalizePath(base).toLowerCase()
  if (a === b)
    return true
  return a.startsWith(`${b}/`)
}

/** Forward-slash path of `absolute` relative to `base`. Empty string when equal. */
export function computeRelativePath(absolute: string, base: string): string {
  const a = normalizePath(absolute)
  const b = normalizePath(base)
  if (a.toLowerCase() === b.toLowerCase())
    return ''
  if (a.toLowerCase().startsWith(`${b.toLowerCase()}/`))
    return a.slice(b.length + 1)
  return a
}

export function shouldIgnoreAbsolutePath(absolute: string): boolean {
  const parts = normalizePath(absolute).split('/').filter(Boolean)
  return parts.some(p => IGNORE_DIRS.has(p.toLowerCase()))
}

function stripQuotes(s: string): string {
  const trimmed = s.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === '\'' && last === '\''))
      return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Resolve a raw token (possibly quoted) into an absolute path against
 * `cwd`, then validate it lives inside the project and isn't in an
 * ignored directory. Returns null when the path is unusable.
 */
export function resolvePathTarget(
  rawPath: string,
  cwd: string,
  projectPath: string,
): { absolute: string; relative: string } | null {
  const cleaned = stripQuotes(rawPath)
  if (!cleaned)
    return null
  if (cleaned.startsWith('-'))
    return null
  if (cleaned === '/dev/null' || cleaned.startsWith('/dev/'))
    return null
  if (/^[a-z]+:\/\//i.test(cleaned))
    return null
  if (cleaned.includes('$') || cleaned.includes('`'))
    return null

  const isWindowsAbs = /^[A-Z]:[\\/]/i.test(cleaned)
  const isUnixAbs = cleaned.startsWith('/')
  const absolute = isWindowsAbs || isUnixAbs
    ? cleaned
    : `${normalizePath(cwd)}/${cleaned}`
  const normalized = normalizePath(absolute)

  if (shouldIgnoreAbsolutePath(normalized))
    return null
  if (!isWithinPath(normalized, projectPath))
    return null

  return {
    absolute: normalized,
    relative: computeRelativePath(normalized, projectPath),
  }
}

// ---------------------------------------------------------------------------
// Glob expansion
// ---------------------------------------------------------------------------

/** Convert a shell glob (`*`, `?`) to a regex anchored at both ends. */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`)
}

/**
 * Expand a single-segment glob pattern by listing the immediate parent
 * directory and matching entries. Returns absolute paths (capped at
 * MAX_GLOB_RESULTS). Returns [pattern] unchanged when it has no wildcards
 * or the parent directory doesn't exist.
 */
export async function expandGlob(pattern: string, cwd: string): Promise<string[]> {
  if (!/[*?]/.test(pattern))
    return [pattern]

  const slashIdx = pattern.lastIndexOf('/')
  const dir = slashIdx === -1 ? cwd : `${normalizePath(cwd)}/${pattern.slice(0, slashIdx)}`
  const leaf = slashIdx === -1 ? pattern : pattern.slice(slashIdx + 1)

  try {
    if (!await exists(dir))
      return []
  }
  catch {
    return []
  }

  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(dir)
  }
  catch {
    return []
  }

  const re = globToRegex(leaf)
  const matches: string[] = []
  for (const entry of entries) {
    if (!entry.name)
      continue
    if (re.test(entry.name)) {
      matches.push(`${dir}/${entry.name}`)
      if (matches.length >= MAX_GLOB_RESULTS)
        break
    }
  }
  return matches
}

// ---------------------------------------------------------------------------
// Top-level extraction
// ---------------------------------------------------------------------------

interface RawTarget {
  rawPath: string
  reason: string
}

function collectFromSegment(segment: string): RawTarget[] {
  const out: RawTarget[] = []
  const base = identifyBaseCommand(segment)

  // Redirects apply regardless of base command
  for (const path of extractRedirectTargets(segment)) {
    out.push({ rawPath: path, reason: 'redirect' })
  }

  if (!base)
    return out

  switch (base) {
    case 'sed':
      for (const path of extractSedFiles(segment))
        out.push({ rawPath: path, reason: 'sed -i' })
      break
    case 'rm':
      for (const path of extractRmFiles(segment))
        out.push({ rawPath: path, reason: 'rm' })
      break
    case 'mv': {
      const m = extractMvTargets(segment)
      if (m) {
        out.push({ rawPath: m.src, reason: 'mv src' })
        out.push({ rawPath: m.dst, reason: 'mv dst' })
      }
      break
    }
    case 'cp': {
      const c = extractCpTargets(segment)
      if (c)
        out.push({ rawPath: c.dst, reason: 'cp dst' })
      break
    }
    case 'touch':
      for (const path of extractTouchFiles(segment))
        out.push({ rawPath: path, reason: 'touch' })
      break
    case 'tee':
      for (const path of extractTeeFiles(segment))
        out.push({ rawPath: path, reason: 'tee' })
      break
    case 'truncate':
      for (const path of extractTruncateFiles(segment))
        out.push({ rawPath: path, reason: 'truncate' })
      break
    case 'dd': {
      const of = extractDdFile(segment)
      if (of)
        out.push({ rawPath: of, reason: 'dd of=' })
      break
    }
    case 'git': {
      for (const path of extractGitCheckoutFiles(segment))
        out.push({ rawPath: path, reason: 'git checkout' })
      for (const path of extractGitRestoreFiles(segment))
        out.push({ rawPath: path, reason: 'git restore' })
      break
    }
  }

  return out
}

/**
 * Walk a compound shell command, resolve every detected mutation
 * target against `cwd`, expand simple globs, filter to paths inside
 * the project, and return a deduplicated list of snapshot targets.
 *
 * Pure-parsing failures are swallowed — a command we can't parse
 * simply yields zero targets, which is safe (the command will still
 * run, we just won't snapshot its mutations).
 */
export async function extractShellMutationTargets(
  command: string,
  options: MutationParserOptions,
): Promise<ShellMutationTarget[]> {
  const { cwd, projectPath } = options
  if (!projectPath)
    return []

  const segments = parseShellSegments(command)
  const raw: RawTarget[] = []
  for (const seg of segments)
    raw.push(...collectFromSegment(seg))

  const seen = new Set<string>()
  const result: ShellMutationTarget[] = []

  for (const { rawPath, reason } of raw) {
    const candidates = /[*?]/.test(rawPath)
      ? await expandGlob(rawPath, cwd)
      : [rawPath]

    for (const candidate of candidates) {
      const resolved = resolvePathTarget(candidate, cwd, projectPath)
      if (!resolved)
        continue
      const key = resolved.absolute.toLowerCase()
      if (seen.has(key))
        continue
      seen.add(key)
      result.push({
        absolutePath: resolved.absolute,
        relativePath: resolved.relative,
        reason,
      })
    }
  }

  return result
}
