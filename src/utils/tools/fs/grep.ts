import { invoke } from '@tauri-apps/api/core'
import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { safePath } from './allowedPaths'

// ---------------------------------------------------------------------------
// Response type from the Rust command
// ---------------------------------------------------------------------------

interface GrepResult {
  message: string
  numMatches: number
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function createGrepTool(projectPath: string) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.grep,
    inputSchema: z.object({
      pattern: z
        .string()
        .describe('The text or regex pattern to search for in file contents.'),
      path: z
        .string()
        .optional()
        .describe('Directory to search in. Can be absolute or relative to the project root. Default: project root.'),
      regex: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, treats pattern as a regular expression. Default: false (literal string search).'),
      glob: z
        .string()
        .optional()
        .describe('Glob pattern to restrict search to specific files (e.g. "*.ts", "src/components/**").'),
      case_sensitive: z
        .boolean()
        .optional()
        .default(true)
        .describe('If true, search is case-sensitive. Default: true.'),
      context_lines: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .default(1)
        .describe('Lines of context to include before and after each match. Default: 1. Max: 5.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(300)
        .optional()
        .default(100)
        .describe('Maximum number of matches to return. Default: 100. Max: 300.'),
      files_only: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, returns only file paths containing matches (no content). Default: false.'),
      multiline: z
        .boolean()
        .optional()
        .default(false)
        .describe('Enable multiline matching — pattern can span line boundaries. Default: false.'),
    }),

    execute: async ({ pattern, path: inputPath, regex, glob, case_sensitive, context_lines, limit, files_only, multiline }) => {
      const isAbsolute = (p: string) => /^(?:[a-z]:[/\\]|\/|\\\\)/i.test(p)
      const rawPath = inputPath
        ? (inputPath === '.' ? projectPath : isAbsolute(inputPath) ? inputPath : `${projectPath}/${inputPath}`)
        : projectPath

      // Path security
      let basePath: string
      try {
        basePath = await safePath(projectPath, rawPath, { kind: 'read' })
      }
      catch (e) {
        return { message: `Error: ${e instanceof Error ? e.message : String(e)}`, numMatches: 0 }
      }

      try {
        const result = await invoke<GrepResult>('grep_search', {
          basePath,
          pattern,
          regex,
          glob,
          caseSensitive: case_sensitive,
          contextLines: context_lines,
          limit,
          filesOnly: files_only,
          multiline,
        })
        return { message: result.message, numMatches: result.numMatches }
      }
      catch (e) {
        return { message: `Error: ${e instanceof Error ? e.message : String(e)}`, numMatches: 0 }
      }
    },
  })
}
