import { invoke } from '@tauri-apps/api/core'
import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from '../toolDescriptions'
import { safePath } from './allowedPaths'

// ---------------------------------------------------------------------------
// Response type from the Rust command
// ---------------------------------------------------------------------------

interface GlobResult {
  message: string
  numFiles: number
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function createGlobTool(projectPath: string) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.glob,
    inputSchema: z.object({
      pattern: z
        .string()
        .describe('The glob pattern to match files against. Examples: "**/*.ts", "src/**/*.{js,jsx}", "*.config.*"'),
      path: z
        .string()
        .optional()
        .describe('Directory to search from. Can be absolute or relative to the project root. Default: project root.'),
      limit: z
        .number()
        .optional()
        .default(200)
        .describe('Maximum number of results to return. Default: 200. Max: 1000.'),
      dot: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, include hidden dotfiles and dot-directories (e.g. .env, .github/). Default: false.'),
      no_gitignore: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, bypass .gitignore filtering. Default: false.'),
      ignore: z
        .array(z.string())
        .optional()
        .describe('Additional glob patterns to exclude from results. Applied after .gitignore. Example: ["**/node_modules/**", "**/*.test.ts"]'),
    }),

    execute: async ({ pattern, path: inputPath, limit, dot, no_gitignore, ignore }) => {
      const isAbsolute = (p: string) => /^[a-z]:[/\\]|^\/|^\\\\/i.test(p)
      const rawPath = inputPath
        ? (inputPath === '.' ? projectPath : isAbsolute(inputPath) ? inputPath : `${projectPath}/${inputPath}`)
        : projectPath

      // Path security — search inside allowed roots, sensitive files still blocked
      let basePath: string
      try {
        basePath = await safePath(projectPath, rawPath, { kind: 'search' })
      }
      catch (e) {
        return { message: `Error: ${e instanceof Error ? e.message : String(e)}`, numFiles: 0 }
      }

      try {
        const result = await invoke<GlobResult>('glob_search', {
          basePath,
          pattern,
          limit,
          dot,
          noGitignore: no_gitignore,
          ignorePatterns: ignore,
        })
        return { message: result.message, numFiles: result.numFiles }
      }
      catch (e) {
        return { message: `Error: ${e instanceof Error ? e.message : String(e)}`, numFiles: 0 }
      }
    },
  })
}
