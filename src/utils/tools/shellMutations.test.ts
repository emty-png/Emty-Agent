/**
 * src/utils/tools/shellMutations.test.ts
 *
 * Unit tests for the shell command mutation parser. Covers pure
 * parsers directly and the async entry point with a stubbed
 * `@tauri-apps/plugin-fs` for glob expansion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeRelativePath,
  extractCpTargets,
  extractDdFile,
  extractGitCheckoutFiles,
  extractGitRestoreFiles,
  extractMvTargets,
  extractRedirectTargets,
  extractRmFiles,
  extractSedFiles,
  extractShellMutationTargets,
  extractTeeFiles,
  extractTouchFiles,
  extractTruncateFiles,
  globToRegex,
  identifyBaseCommand,
  isWithinPath,
  normalizePath,
  parseShellSegments,
  resolvePathTarget,
  shouldIgnoreAbsolutePath,
  splitShellArgs,
} from './shellMutations'

// Stub the Tauri fs plugin so we don't need a Tauri runtime.
// `exists` and `readDir` are only used by expandGlob.
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async () => true),
  readDir: vi.fn(async () => []),
}))

const PROJECT = '/home/user/project'

describe('normalizePath', () => {
  it('collapses backslashes and mixed separators', () => {
    expect(normalizePath('a\\b/c\\\\d')).toBe('a/b/c/d')
  })

  it('resolves single dots and double dots', () => {
    expect(normalizePath('a/./b/../c')).toBe('a/c')
  })

  it('preserves leading slashes', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c')
  })

  it('preserves drive letters on Windows-style paths', () => {
    expect(normalizePath('C:\\Users\\foo\\..\\bar')).toBe('C:/Users/bar')
  })
})

describe('isWithinPath', () => {
  it('matches the base itself', () => {
    expect(isWithinPath(PROJECT, PROJECT)).toBe(true)
  })

  it('matches a child', () => {
    expect(isWithinPath(`${PROJECT}/src/a.ts`, PROJECT)).toBe(true)
  })

  it('rejects a sibling with shared prefix', () => {
    expect(isWithinPath(`${PROJECT}-other/x`, PROJECT)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isWithinPath(`${PROJECT.toUpperCase()}/x`, PROJECT)).toBe(true)
  })
})

describe('computeRelativePath', () => {
  it('returns empty for the base itself', () => {
    expect(computeRelativePath(PROJECT, PROJECT)).toBe('')
  })

  it('returns the suffix for a child', () => {
    expect(computeRelativePath(`${PROJECT}/src/a.ts`, PROJECT)).toBe('src/a.ts')
  })
})

describe('shouldIgnoreAbsolutePath', () => {
  it('flags node_modules and .git', () => {
    expect(shouldIgnoreAbsolutePath(`${PROJECT}/node_modules/foo`)).toBe(true)
    expect(shouldIgnoreAbsolutePath(`${PROJECT}/.git/config`)).toBe(true)
  })

  it('does not flag source files', () => {
    expect(shouldIgnoreAbsolutePath(`${PROJECT}/src/a.ts`)).toBe(false)
  })
})

describe('parseShellSegments', () => {
  it('splits on semicolons', () => {
    expect(parseShellSegments('a; b; c')).toEqual(['a', 'b', 'c'])
  })

  it('splits on pipes', () => {
    expect(parseShellSegments('a | b && c || d')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('respects quotes', () => {
    expect(parseShellSegments('echo "a;b" | cat')).toEqual(['echo "a;b"', 'cat'])
  })

  it('returns the single segment when no separators', () => {
    expect(parseShellSegments('echo hello')).toEqual(['echo hello'])
  })

  it('treats subshells as opaque', () => {
    expect(parseShellSegments('echo $(a;b) ; ls')).toEqual(['echo $(a;b)', 'ls'])
  })
})

describe('splitShellArgs', () => {
  it('splits on whitespace respecting quotes', () => {
    expect(splitShellArgs('a \'b c\' "d e" f')).toEqual(['a', 'b c', 'd e', 'f'])
  })

  it('handles backslash escapes', () => {
    expect(splitShellArgs(String.raw`a\ b c`)).toEqual(['a b', 'c'])
  })
})

describe('identifyBaseCommand', () => {
  it('returns the lowercase command basename', () => {
    expect(identifyBaseCommand('RM file.txt')).toBe('rm')
  })

  it('strips path prefixes', () => {
    expect(identifyBaseCommand('/usr/bin/sed -i s/a/b/ x')).toBe('sed')
  })

  it('skips env var assignments', () => {
    expect(identifyBaseCommand('FOO=bar BAZ=qux rm file')).toBe('rm')
  })

  it('skips the `command` builtin', () => {
    expect(identifyBaseCommand('command rm file')).toBe('rm')
  })

  it('returns null for empty input', () => {
    expect(identifyBaseCommand('')).toBeNull()
    expect(identifyBaseCommand('   ')).toBeNull()
  })
})

describe('extractRedirectTargets', () => {
  it('extracts > targets', () => {
    expect(extractRedirectTargets('echo hi > out.txt')).toEqual(['out.txt'])
  })

  it('extracts >> targets', () => {
    expect(extractRedirectTargets('echo hi >> out.txt')).toEqual(['out.txt'])
  })

  it('extracts 2> and &>', () => {
    expect(extractRedirectTargets('cmd 2> err.log &> all.log'))
      .toEqual(['err.log', 'all.log'])
  })

  it('skips input redirects', () => {
    expect(extractRedirectTargets('cat < in.txt')).toEqual([])
  })

  it('skips dup operators', () => {
    expect(extractRedirectTargets('cmd 2>&1 1>&2')).toEqual([])
  })

  it('skips /dev/null and similar', () => {
    expect(extractRedirectTargets('cmd > /dev/null')).toEqual([])
  })

  it('strips surrounding quotes', () => {
    expect(extractRedirectTargets('cmd > "my file.txt"')).toEqual(['my file.txt'])
  })

  it('ignores heredoc bodies', () => {
    expect(extractRedirectTargets('cat > out.txt <<EOF\ndata\nEOF'))
      .toEqual(['out.txt'])
  })
})

describe('extractSedFiles', () => {
  it('returns files for sed -i with implicit script', () => {
    expect(extractSedFiles('sed -i \'s/a/b/\' a.txt b.txt')).toEqual(['a.txt', 'b.txt'])
  })

  it('returns files for sed -i with -e', () => {
    expect(extractSedFiles('sed -i -e \'s/a/b/\' file.txt')).toEqual(['file.txt'])
  })

  it('returns files for sed -i.bak', () => {
    expect(extractSedFiles('sed -i.bak \'s/a/b/\' file.txt')).toEqual(['file.txt'])
  })

  it('returns no files when -i is missing', () => {
    expect(extractSedFiles('sed \'s/a/b/\' file.txt')).toEqual([])
  })

  it('returns no files for the wrong command', () => {
    expect(extractSedFiles('rm file.txt')).toEqual([])
  })
})

describe('extractRmFiles', () => {
  it('returns files for rm with options', () => {
    expect(extractRmFiles('rm -rf a b c')).toEqual(['a', 'b', 'c'])
  })

  it('returns the single file', () => {
    expect(extractRmFiles('rm file.txt')).toEqual(['file.txt'])
  })

  it('returns empty for the wrong command', () => {
    expect(extractRmFiles('cp a b')).toEqual([])
  })
})

describe('extractMvTargets', () => {
  it('returns src and dst for mv', () => {
    expect(extractMvTargets('mv old new')).toEqual({ src: 'old', dst: 'new' })
  })

  it('handles options', () => {
    expect(extractMvTargets('mv -f old new')).toEqual({ src: 'old', dst: 'new' })
  })

  it('returns null for the wrong command', () => {
    expect(extractMvTargets('cp a b')).toBeNull()
  })
})

describe('extractCpTargets', () => {
  it('returns src list and dst for cp', () => {
    expect(extractCpTargets('cp a b c')).toEqual({ src: ['a', 'b'], dst: 'c' })
  })

  it('handles -r', () => {
    expect(extractCpTargets('cp -r src/ dst/')).toEqual({ src: ['src/'], dst: 'dst/' })
  })

  it('returns null when args < 2', () => {
    expect(extractCpTargets('cp a')).toBeNull()
  })
})

describe('extractTouchFiles', () => {
  it('skips -t value', () => {
    expect(extractTouchFiles('touch -t 202401011200 a.txt b.txt')).toEqual(['a.txt', 'b.txt'])
  })

  it('skips -d value', () => {
    expect(extractTouchFiles('touch -d "yesterday" a.txt')).toEqual(['a.txt'])
  })
})

describe('extractTeeFiles', () => {
  it('returns files for tee', () => {
    expect(extractTeeFiles('tee a.txt b.txt')).toEqual(['a.txt', 'b.txt'])
  })

  it('skips -a', () => {
    expect(extractTeeFiles('tee -a a.txt')).toEqual(['a.txt'])
  })
})

describe('extractTruncateFiles', () => {
  it('skips -s value', () => {
    expect(extractTruncateFiles('truncate -s 0 a.txt')).toEqual(['a.txt'])
  })
})

describe('extractDdFile', () => {
  it('returns the of= path', () => {
    expect(extractDdFile('dd if=/dev/zero of=out.bin bs=1M count=1')).toBe('out.bin')
  })

  it('returns null when of= is absent', () => {
    expect(extractDdFile('dd if=/dev/zero')).toBeNull()
  })
})

describe('extractGitCheckoutFiles', () => {
  it('returns files after --', () => {
    expect(extractGitCheckoutFiles('git checkout main -- a.txt b.txt'))
      .toEqual(['a.txt', 'b.txt'])
  })

  it('returns the last arg as file when no --', () => {
    expect(extractGitCheckoutFiles('git checkout main file.txt')).toEqual(['file.txt'])
  })

  it('returns empty for non-checkout git commands', () => {
    expect(extractGitCheckoutFiles('git status')).toEqual([])
  })
})

describe('extractGitRestoreFiles', () => {
  it('returns files for git restore', () => {
    expect(extractGitRestoreFiles('git restore --staged a.txt b.txt'))
      .toEqual(['a.txt', 'b.txt'])
  })

  it('skips --source value', () => {
    expect(extractGitRestoreFiles('git restore --source=HEAD a.txt')).toEqual(['a.txt'])
  })
})

describe('globToRegex', () => {
  it('matches a single-segment glob', () => {
    const re = globToRegex('*.txt')
    expect(re.test('foo.txt')).toBe(true)
    expect(re.test('foo.ts')).toBe(false)
    expect(re.test('a/foo.txt')).toBe(false)
  })

  it('matches ? for a single char', () => {
    const re = globToRegex('a?b')
    expect(re.test('axb')).toBe(true)
    expect(re.test('ab')).toBe(false)
    expect(re.test('axxb')).toBe(false)
  })
})

describe('resolvePathTarget', () => {
  it('resolves a relative path against cwd', () => {
    const cwd = `${PROJECT}/src`
    const r = resolvePathTarget('a.ts', cwd, PROJECT)
    expect(r).toEqual({
      absolute: `${PROJECT}/src/a.ts`,
      relative: 'src/a.ts',
    })
  })

  it('keeps absolute paths inside the project', () => {
    const r = resolvePathTarget(`${PROJECT}/a.ts`, PROJECT, PROJECT)
    expect(r?.relative).toBe('a.ts')
  })

  it('rejects paths outside the project', () => {
    expect(resolvePathTarget('/etc/passwd', PROJECT, PROJECT)).toBeNull()
  })

  it('rejects ignored directories', () => {
    expect(resolvePathTarget(`${PROJECT}/node_modules/x`, PROJECT, PROJECT)).toBeNull()
  })

  it('rejects env-var placeholders', () => {
    expect(resolvePathTarget('$HOME/x', PROJECT, PROJECT)).toBeNull()
  })

  it('strips surrounding quotes', () => {
    const r = resolvePathTarget('"my file.ts"', PROJECT, PROJECT)
    expect(r?.relative).toBe('my file.ts')
  })
})

describe('extractShellMutationTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty for an empty command', async () => {
    const out = await extractShellMutationTargets('', { cwd: PROJECT, projectPath: PROJECT })
    expect(out).toEqual([])
  })

  it('returns empty when no project path', async () => {
    const out = await extractShellMutationTargets('rm a.txt', { cwd: PROJECT, projectPath: '' })
    expect(out).toEqual([])
  })

  it('captures rm and redirect in a compound command', async () => {
    const out = await extractShellMutationTargets(
      'rm a.txt && echo done > b.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    const rels = out.map(t => t.relativePath).sort()
    expect(rels).toEqual(['a.txt', 'b.txt'])
  })

  it('captures sed -i file', async () => {
    const out = await extractShellMutationTargets(
      'sed -i \'s/a/b/\' a.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    expect(out[0]?.relativePath).toBe('a.txt')
    expect(out[0]?.reason).toBe('sed -i')
  })

  it('captures both sides of mv', async () => {
    const out = await extractShellMutationTargets(
      'mv old.txt new.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    const rels = out.map(t => t.relativePath).sort()
    expect(rels).toEqual(['new.txt', 'old.txt'])
  })

  it('captures only the dst of cp', async () => {
    const out = await extractShellMutationTargets(
      'cp src.txt dst.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    expect(out.map(t => t.relativePath)).toEqual(['dst.txt'])
  })

  it('captures git checkout -- files', async () => {
    const out = await extractShellMutationTargets(
      'git checkout -- a.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    expect(out[0]?.relativePath).toBe('a.txt')
    expect(out[0]?.reason).toBe('git checkout')
  })

  it('skips ignored directories', async () => {
    const out = await extractShellMutationTargets(
      'rm node_modules/x.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    expect(out).toEqual([])
  })

  it('skips files outside the project', async () => {
    const out = await extractShellMutationTargets(
      'rm /etc/passwd',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    expect(out).toEqual([])
  })

  it('deduplicates the same target across segments', async () => {
    const out = await extractShellMutationTargets(
      'rm a.txt && rm a.txt',
      { cwd: PROJECT, projectPath: PROJECT },
    )
    expect(out).toHaveLength(1)
  })
})
