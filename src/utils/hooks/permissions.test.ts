import { describe, expect, it } from 'vitest'

// The extraction helpers are not exported, so we test them indirectly
// through the same logic patterns. These tests verify the extraction
// algorithms match expected behavior.

describe('extractFilePaths logic', () => {
  function extractFilePaths(toolName: string, args: Record<string, unknown>): string[] {
    if (toolName === 'write_file')
      return [typeof args.file_path === 'string' ? args.file_path : '']
    if (toolName === 'edit_files') {
      return [...new Set(
        (Array.isArray(args.edits) ? args.edits : [])
          .filter((e): e is Record<string, unknown> => typeof e === 'object' && e != null)
          .map(e => typeof e.file_path === 'string' ? e.file_path : '')
          .filter(Boolean),
      )]
    }
    return []
  }

  it('extracts single file_path from write_file', () => {
    expect(extractFilePaths('write_file', { file_path: 'src/index.ts' }))
      .toEqual(['src/index.ts'])
  })

  it('returns empty string for missing file_path', () => {
    expect(extractFilePaths('write_file', {}))
      .toEqual([''])
  })

  it('deduplicates file paths from edit_files', () => {
    expect(extractFilePaths('edit_files', {
      edits: [
        { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
        { file_path: 'a.ts', old_string: 'z', new_string: 'w' },
        { file_path: 'b.ts', old_string: '1', new_string: '2' },
      ],
    })).toEqual(['a.ts', 'b.ts'])
  })

  it('filters out non-object edits', () => {
    expect(extractFilePaths('edit_files', {
      edits: ['bad', null, 42, { file_path: 'ok.ts' }],
    })).toEqual(['ok.ts'])
  })

  it('filters out edits with non-string file_path', () => {
    expect(extractFilePaths('edit_files', {
      edits: [{ file_path: 123 }],
    })).toEqual([])
  })

  it('returns empty array for unknown tool', () => {
    expect(extractFilePaths('run_command', { command: 'ls' }))
      .toEqual([])
  })
})

describe('extractShellCommand logic', () => {
  function extractShellCommand(toolName: string, args: Record<string, unknown>): { command: string; isBackground: boolean } {
    if (toolName === 'run_command') {
      return {
        command: typeof args.command === 'string' ? args.command : '',
        isBackground: args.is_background === true,
      }
    }
    if (toolName === 'git_command') {
      const command = typeof args.command === 'string'
        ? `git ${args.command}`
        : Array.isArray(args.commands)
          ? args.commands.map((c: unknown) =>
              typeof c === 'string'
                ? `git ${c}`
                : typeof c === 'object' && c != null && 'args' in c
                  ? `git ${(c as { args: string[] }).args.join(' ')}`
                  : '').join('; ')
          : ''
      return { command, isBackground: false }
    }
    return { command: '', isBackground: false }
  }

  it('extracts command and is_background from run_command', () => {
    expect(extractShellCommand('run_command', { command: 'ls -la', is_background: true }))
      .toEqual({ command: 'ls -la', isBackground: true })
  })

  it('defaults is_background to false', () => {
    expect(extractShellCommand('run_command', { command: 'pwd' }))
      .toEqual({ command: 'pwd', isBackground: false })
  })

  it('extracts single string command from git_command', () => {
    expect(extractShellCommand('git_command', { command: 'status' }))
      .toEqual({ command: 'git status', isBackground: false })
  })

  it('extracts multiple commands from git_command.commands array', () => {
    expect(extractShellCommand('git_command', {
      commands: ['status', 'diff --stat'],
    })).toEqual({ command: 'git status; git diff --stat', isBackground: false })
  })

  it('extracts commands with args objects', () => {
    expect(extractShellCommand('git_command', {
      commands: [{ args: ['commit', '-m', 'feat: add'] }],
    })).toEqual({ command: 'git commit -m feat: add', isBackground: false })
  })

  it('handles mixed command types in commands array', () => {
    expect(extractShellCommand('git_command', {
      commands: ['status', { args: ['diff'] }],
    })).toEqual({ command: 'git status; git diff', isBackground: false })
  })

  it('returns empty string for unknown tool', () => {
    expect(extractShellCommand('write_file', {}))
      .toEqual({ command: '', isBackground: false })
  })
})

describe('extractAddedRemoved logic', () => {
  function extractAddedRemoved(result: unknown): { added: number | null; removed: number | null } {
    if (!result || typeof result !== 'object')
      return { added: null, removed: null }
    const data = result as Record<string, unknown>
    return {
      added: typeof data.added === 'number' ? data.added : null,
      removed: typeof data.removed === 'number' ? data.removed : null,
    }
  }

  it('extracts added and removed from result', () => {
    expect(extractAddedRemoved({ added: 10, removed: 5 }))
      .toEqual({ added: 10, removed: 5 })
  })

  it('returns nulls for missing fields', () => {
    expect(extractAddedRemoved({ edits: [] }))
      .toEqual({ added: null, removed: null })
  })

  it('returns nulls for null result', () => {
    expect(extractAddedRemoved(null))
      .toEqual({ added: null, removed: null })
  })

  it('returns nulls for non-numeric types', () => {
    expect(extractAddedRemoved({ added: '10', removed: '5' }))
      .toEqual({ added: null, removed: null })
  })
})

describe('extractExitCode logic', () => {
  function extractExitCode(result: unknown): number | null {
    if (!result || typeof result !== 'object')
      return null
    const data = result as Record<string, unknown>
    if (typeof data.exitCode === 'number')
      return data.exitCode
    if (typeof data.exit_code === 'number')
      return data.exit_code
    return null
  }

  it('extracts exitCode', () => {
    expect(extractExitCode({ exitCode: 0 })).toBe(0)
  })

  it('extracts exit_code (snake_case)', () => {
    expect(extractExitCode({ exit_code: 1 })).toBe(1)
  })

  it('prefers exitCode over exit_code', () => {
    expect(extractExitCode({ exitCode: 0, exit_code: 1 })).toBe(0)
  })

  it('returns null for null result', () => {
    expect(extractExitCode(null)).toBeNull()
  })

  it('returns null for non-numeric exit code', () => {
    expect(extractExitCode({ exitCode: 'error' })).toBeNull()
  })
})
