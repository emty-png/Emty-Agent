/**
 * src/utils/tools/subagent.ts
 *
 * The spawn_subagent tool lets the main agent delegate focused work to a
 * purpose-built sub-agent that runs in its own tab with live streaming.
 *
 * Four personalities, each with a scoped tool set and a focused system prompt:
 *   • Explorer   — read-only codebase investigation (list, read, glob, grep)
 *   • Researcher — web-only information gathering (web_search, web_fetch)
 *   • Debugger   — bug hunting (filesystem reads + web search)
 *   • General    — full capability (filesystem read+write, shell, web)
 *
 * Execution model:
 *   execute() is BLOCKING from the parent agent's perspective.
 *   It calls onSpawn() (provided by the chat store) which synchronously creates
 *   a tab and starts an async stream. execute() then awaits completionPromise so
 *   the parent agent receives the sub-agent's full output as a tool result.
 *
 *   If the parent stream is aborted (user clicks Stop), onAbortSubAgent() is
 *   called to abort the sub-agent's stream controller too.
 *
 * Constraints:
 *   • Sub-agents never have ask_questions, write_todo, or spawn_subagent
 *     (no recursive spawning, no UI interaction tools).
 *   • General personality sub-agents have full filesystem + shell + web access
 *     but still cannot spawn further sub-agents.
 *   • If the tab limit is reached, execute() returns an error to the main agent
 *     rather than silently failing.
 *   • Sub-agent output is truncated at MAX_RESULT_CHARS before being returned
 *     to the main agent context to prevent token budget exhaustion.
 */

import type { OsInfo } from '@/utils/os'
import { tool } from 'ai'
import { z } from 'zod'

// ── types ─────────────────────────────────────────────────────────────────────

export type SubAgentPersonality = 'explorer' | 'researcher' | 'debugger' | 'general'

export interface SubAgentInfo {
  personality: SubAgentPersonality
  mission: string
  /** ID of the tab that spawned this sub-agent — used for the "Go to parent" action. */
  parentTabId: string
  status: 'running' | 'done' | 'error'
}

export interface SubAgentOutcome {
  text: string
  status: 'done' | 'error'
}

export interface SubAgentSpawnResult {
  tabId: string
  completionPromise: Promise<SubAgentOutcome>
}

/** Callback provided by the chat store. Called inside execute(). */
export type SubAgentSpawnCallback = (params: {
  personality: SubAgentPersonality
  mission: string
}) => Promise<SubAgentSpawnResult>

/** Callback to abort a running sub-agent from outside execute(). */
export type SubAgentAbortCallback = (tabId: string) => void

// ── personality metadata (used by UI components) ──────────────────────────────

export const PERSONALITY_META = {
  explorer: {
    label: 'Explorer',
    shortDesc: 'Read-only codebase investigation',
    /** CSS custom property name suffix — maps to --color-<colorKey> variables. */
    colorKey: 'info',
  },
  researcher: {
    label: 'Researcher',
    shortDesc: 'Web research & synthesis',
    colorKey: 'success',
  },
  debugger: {
    label: 'Debugger',
    shortDesc: 'Bug finding & root cause analysis',
    colorKey: 'warning',
  },
  general: {
    label: 'General',
    shortDesc: 'Full-capability task execution',
    colorKey: 'accent',
  },
} as const satisfies Record<SubAgentPersonality, { label: string; shortDesc: string; colorKey: string }>

// ── sub-agent system prompts ──────────────────────────────────────────────────

function projectSection(projectPath: string | null): string {
  return projectPath
    ? `\n\n## Project\nWorking directory: \`${projectPath}\`\nAll file paths in tool calls are relative to this directory.`
    : ''
}

function osSection(osInfo?: OsInfo): string {
  if (!osInfo)
    return ''
  const isWin = osInfo.platform === 'windows'
  return `\n\n## Operating Environment\n- Platform: ${osInfo.displayName} ${osInfo.version} (${osInfo.arch})\n- Shell: ${isWin ? 'PowerShell' : 'sh (POSIX)'}\n- Path separator: ${isWin ? '\\' : '/'}`
}

export function explorerSystemPrompt(projectPath: string | null, osInfo?: OsInfo): string {
  return `You are an Explorer sub-agent — a focused, read-only codebase investigator.

## Role
Explore and understand the codebase to answer the mission you have been given.
Produce a thorough, well-structured report of your findings.

## Operating principles
- Start with a directory listing to understand the project layout before drilling in.
- Read only the files that are directly relevant to the mission.
- Use glob to find files by pattern; use grep to trace usages and definitions.
- Never assume file contents — verify by reading them.
- You have NO write access. Do not write, edit, delete, or run commands.
- Stay strictly scoped to the mission. Do not explore unrelated areas.

## Output format
Conclude with a structured report:
- **What you found** and where exactly (file + line when relevant)
- **Relevant code excerpts** (inline, short — never dump entire files)
- **Gaps or concerns** you noticed along the way
- **Direct answer** to the mission question${projectSection(projectPath)}${osSection(osInfo)}`
}

export function researcherSystemPrompt(osInfo?: OsInfo): string {
  return `You are a Researcher sub-agent — an expert at gathering and synthesising information from the web.

## Role
Research the mission topic thoroughly using web search and page fetching.
Deliver a well-organised, cited report of your findings.

## Operating principles
- Run multiple targeted searches to cover the topic from different angles.
- Fetch full pages when a search snippet is not enough detail.
- Verify important claims across at least two independent sources.
- Prefer official documentation, reputable publications, and recent content.
- Always include source URLs so findings are verifiable.
- Be objective — present what you found, not what you want to find.

## Output format
Produce a structured research report:
- **Summary** (2–3 sentences)
- **Key findings** with inline citations (URL in parentheses)
- **Conflicting information** found across sources
- **Gaps** — things you could not verify or find${osSection(osInfo)}`
}

export function debuggerSystemPrompt(projectPath: string | null, osInfo?: OsInfo): string {
  return `You are a Debugger sub-agent — an expert at tracing bugs to their root cause.

## Role
Investigate the bug or issue described in your mission.
Find the root cause, not symptoms. Produce an actionable diagnosis.

## Operating principles
- Map the relevant code paths before drawing conclusions.
- Read callsites, not just definitions; trace data flow end-to-end.
- Use grep to find all usages of suspected functions, variables, or patterns.
- Search the web for known bugs, CVEs, or library issues when appropriate.
- Distinguish between the bug itself and the code that surfaces it.
- Never suggest a fix that patches symptoms while leaving the root cause.

## Output format
Conclude with a precise diagnosis:
- **Root cause** (exact file, line, and explanation)
- **Why it fails** — the logical error in plain terms
- **Reproduction path** — how the bug is triggered
- **Recommended fix** — concrete and minimal
- **Risk of the fix** — any edge cases or side effects${projectSection(projectPath)}${osSection(osInfo)}`
}

export function generalSystemPrompt(projectPath: string | null, osInfo?: OsInfo): string {
  return `You are a General-purpose sub-agent with full capabilities.

## Role
Complete the mission you have been given as efficiently and correctly as possible.
Use whatever tools are needed. Produce a clear deliverable.

## Operating principles
- Read before writing. Understand existing patterns before changing them.
- Prefer the smallest safe change that fully satisfies the mission.
- Match the existing architecture, naming, style, and error-handling patterns.
- Fix root causes, not symptoms.
- Do not leave stubs, TODOs, or partially wired code.
- Cover edge cases, validation, and failure paths.

## Quality bar
All work must be production-ready:
- Predictable failure handling
- No dead code or hidden side effects
- Clear control flow
- No leakage of secrets or sensitive data${projectSection(projectPath)}${osSection(osInfo)}`
}

export function buildSubAgentSystemPrompt(
  personality: SubAgentPersonality,
  projectPath: string | null,
  osInfo?: OsInfo,
): string {
  switch (personality) {
    case 'explorer': return explorerSystemPrompt(projectPath, osInfo)
    case 'researcher': return researcherSystemPrompt(osInfo)
    case 'debugger': return debuggerSystemPrompt(projectPath, osInfo)
    case 'general': return generalSystemPrompt(projectPath, osInfo)
  }
}

// ── tool result truncation ────────────────────────────────────────────────────

/**
 * Max characters of sub-agent output returned to the main agent as a tool result.
 * Long outputs are head+tail trimmed so the key conclusion (end) is always visible.
 */
const MAX_RESULT_CHARS = 8_000

export function truncateSubAgentResult(text: string): string {
  if (text.length <= MAX_RESULT_CHARS)
    return text
  const half = Math.floor(MAX_RESULT_CHARS / 2)
  return `${text.slice(0, half).trimEnd()}\n\n[... ${Math.round(text.length / 1024)} KB — middle trimmed — showing head and tail ...]\n\n${text.slice(-half).trimStart()}`
}

// ── tool factory ──────────────────────────────────────────────────────────────

export function createSpawnSubAgentTool(
  onSpawn: SubAgentSpawnCallback,
  onAbortSubAgent: SubAgentAbortCallback,
) {
  return tool({
    description: `\
Spawn a focused sub-agent in its own tab to handle a specific part of the current task.
The sub-agent runs with a fresh context, inherits the current model and project, and streams
its work live in a dedicated tab the user can watch.

This tool BLOCKS until the sub-agent finishes — use it when you need its output before proceeding.
The sub-agent's complete response is returned to you as the tool result.

PERSONALITIES — choose the one scoped to the task:
  • "explorer"   — Read-only codebase investigation. Maps structure, reads files, traces code.
                   Use when you need a detailed understanding of existing code.
  • "researcher" — Web-only research. Searches, fetches pages, synthesises findings.
                   Use when you need up-to-date external information.
  • "debugger"   — Reads code + searches web. Traces bugs to root cause.
                   Use when you have identified a bug and need deep diagnosis.
  • "general"    — Full capabilities (read+write filesystem, shell, web).
                   Use for self-contained implementation sub-tasks.

MISSION — write a self-contained instruction the sub-agent can act on without parent context:
  ✓ "Find where authentication tokens are validated in the codebase and report the exact flow"
  ✓ "Research the latest breaking changes in React 19 and summarise migration steps"
  ✗ "Do what we just discussed" — sub-agent has no parent context
  ✗ "Fix the bug" — too vague, no location or description

WHEN TO USE:
  • Complex multi-part tasks where independent parallel investigation helps
  • Tasks requiring deep focused work on one area (e.g. trace full auth flow)
  • Web research that would clutter the main response
  • Self-contained implementation sub-tasks

WHEN NOT TO USE:
  • Simple single-step lookups — use the tool directly instead
  • When you already have enough context — do the work yourself
  • Recursive spawning is not allowed`,

    inputSchema: z.object({
      personality: z
        .enum(['explorer', 'researcher', 'debugger', 'general'])
        .describe(
          'Sub-agent personality. Determines tool access and system prompt. '
          + 'explorer=read-only code, researcher=web-only, debugger=code+web, general=all tools.',
        ),
      mission: z
        .string()
        .min(10)
        .max(2000)
        .describe(
          'Self-contained task description. Must be understandable without the parent conversation. '
          + 'Include specific file paths, function names, or URLs when relevant.',
        ),
    }),

    execute: async ({ personality, mission }, { abortSignal }) => {
      // Already aborted before we even start
      if (abortSignal?.aborted) {
        return {
          personality,
          mission,
          status: 'aborted',
          error: 'Cancelled before the sub-agent could start.',
        }
      }

      let spawnResult: SubAgentSpawnResult
      try {
        spawnResult = await onSpawn({ personality, mission })
      }
      catch (e) {
        return {
          personality,
          mission,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        }
      }

      // If the parent stream is aborted while sub-agent is running, abort it too.
      const parentAbortHandler = () => {
        onAbortSubAgent(spawnResult.tabId)
      }
      abortSignal?.addEventListener('abort', parentAbortHandler, { once: true })

      let outcome: SubAgentOutcome
      try {
        outcome = await spawnResult.completionPromise
      }
      catch {
        outcome = { text: '', status: 'error' }
      }
      finally {
        abortSignal?.removeEventListener('abort', parentAbortHandler)
      }

      if (outcome.status === 'error') {
        return {
          personality,
          mission,
          status: 'error',
          error: 'Sub-agent encountered an error during execution.',
        }
      }

      return {
        personality,
        mission,
        status: 'done',
        result: truncateSubAgentResult(outcome.text),
      }
    },
  })
}

export type SpawnSubAgentTool = ReturnType<typeof createSpawnSubAgentTool>

// ── display label ─────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}\u2026` : t
}

export function subAgentDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'spawn_subagent')
    return `Called ${toolName}`

  const personality = args.personality as SubAgentPersonality | undefined
  const mission = args.mission as string | undefined
  const label = personality ? PERSONALITY_META[personality].label : 'Agent'

  if (!mission)
    return `Spawned ${label}`

  return `${label} \u00B7 ${truncate(mission, 52)}`
}
