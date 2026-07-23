import type { HookEntry } from './types'
import { describe, expect, it } from 'vitest'
import { matchesHookEntry } from './config'

describe('matchesHookEntry', () => {
  // ── Empty / wildcard matcher ──────────────────────────────────────────────

  it('matches all targets when matcher is omitted', () => {
    const entry: HookEntry = { hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'anything')).toBe(true)
  })

  it('matches all targets when matcher is empty string', () => {
    const entry: HookEntry = { matcher: '', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'anything')).toBe(true)
  })

  // ── Exact match ───────────────────────────────────────────────────────────

  it('matches exact tool name', () => {
    const entry: HookEntry = { matcher: 'run_command', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'run_command')).toBe(true)
  })

  it('rejects non-matching exact name', () => {
    const entry: HookEntry = { matcher: 'run_command', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'write_file')).toBe(false)
  })

  // ── Pipe-separated matchers ───────────────────────────────────────────────

  it('matches one of pipe-separated names', () => {
    const entry: HookEntry = { matcher: 'run_command|git_command', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'run_command')).toBe(true)
    expect(matchesHookEntry(entry, 'git_command')).toBe(true)
  })

  it('rejects name not in pipe-separated list', () => {
    const entry: HookEntry = { matcher: 'run_command|git_command', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'write_file')).toBe(false)
  })

  it('trims whitespace around pipe-separated patterns', () => {
    const entry: HookEntry = { matcher: ' run_command | git_command ', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'run_command')).toBe(true)
    expect(matchesHookEntry(entry, 'git_command')).toBe(true)
  })

  // ── Glob patterns ─────────────────────────────────────────────────────────

  it('matches with * wildcard', () => {
    const entry: HookEntry = { matcher: 'write_*', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'write_file')).toBe(true)
    expect(matchesHookEntry(entry, 'write_files')).toBe(true)
  })

  it('rejects non-matching * wildcard', () => {
    const entry: HookEntry = { matcher: 'write_*', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'read_file')).toBe(false)
  })

  it('matches with ? single-char wildcard', () => {
    const entry: HookEntry = { matcher: 'tool?', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'tool1')).toBe(true)
    expect(matchesHookEntry(entry, 'toolA')).toBe(true)
    expect(matchesHookEntry(entry, 'tools')).toBe(true) // ? matches any single char
    expect(matchesHookEntry(entry, 'tool')).toBe(false) // ? requires exactly one char
    expect(matchesHookEntry(entry, 'toolXY')).toBe(false) // ? matches exactly one char
  })

  it('matches file path with glob', () => {
    const entry: HookEntry = { matcher: '*.ts', hooks: [{ command: 'echo' }] }
    // * matches any chars including / so src/index.ts also matches
    expect(matchesHookEntry(entry, 'src/index.ts')).toBe(true)
    expect(matchesHookEntry(entry, 'index.ts')).toBe(true)
    expect(matchesHookEntry(entry, 'index.js')).toBe(false)
  })

  it('handles glob mixed with pipe-separated exact names', () => {
    const entry: HookEntry = { matcher: 'read_*|write_file', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'read_files')).toBe(true)
    expect(matchesHookEntry(entry, 'write_file')).toBe(true)
    expect(matchesHookEntry(entry, 'edit_files')).toBe(false)
  })

  // ── Special regex characters in pattern ────────────────────────────────────

  it('treats dots literally in exact match', () => {
    const entry: HookEntry = { matcher: 'file.txt', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'file.txt')).toBe(true)
    expect(matchesHookEntry(entry, 'fileatxt')).toBe(false)
  })

  it('treats parentheses literally in exact match', () => {
    const entry: HookEntry = { matcher: 'cmd(arg)', hooks: [{ command: 'echo' }] }
    expect(matchesHookEntry(entry, 'cmd(arg)')).toBe(true)
  })
})

describe('hook config type safety', () => {
  it('hookEntry with matcher and hooks is valid', () => {
    const entry: HookEntry = {
      matcher: 'run_command',
      hooks: [{ command: 'echo $EMTY_EVENT', timeoutSec: 10 }],
    }
    expect(entry.matcher).toBe('run_command')
    expect(entry.hooks).toHaveLength(1)
    expect(entry.hooks[0]!.command).toBe('echo $EMTY_EVENT')
    expect(entry.hooks[0]!.timeoutSec).toBe(10)
  })
})
