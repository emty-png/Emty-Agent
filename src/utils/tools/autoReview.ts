import type { LanguageModel } from 'ai'
import type { ToolPermissionRequest } from './permissions'
import { generateText } from 'ai'

const SYSTEM_PROMPT = `You are a safety classifier for a desktop AI coding agent. Given a tool call, determine if it is SAFE or DANGEROUS.

SAFE means: reading files, listing directories, searching code (grep/glob), asking questions, creating tasks, updating tasks, sleeping, loading skills, spawning sub-agents, writing files within the project, editing files within the project, running non-destructive git commands (status, log, diff, add, commit, branch), starting background dev servers, saving memories, creating plans, taking screenshots, simple non-destructive operations.

DANGEROUS means: deleting files or directories (rm, rmdir, del, Remove-Item), moving files outside project (mv, move), force operations (git push -f, --force, git reset --hard), running build/publish/deploy/pack commands (npm build, cargo build, docker build, make, pnpm build), downloading and executing arbitrary scripts (curl | sh, wget | bash), modifying system config outside project, operations affecting files outside the project root, destructive database operations, changing tool parameters or permission settings, network requests to unknown hosts, any command that could cause data loss or system damage.

Tool: {toolName}
Action: {actionTitle}
Details: {actionDetails}

Reply with EXACTLY one word: SAFE or DANGEROUS`

function formatDetails(details: string[]): string {
  return details.join('; ')
}

function parseClassification(text: string): 'safe' | 'dangerous' {
  const normalised = text.trim().toLowerCase()
  if (normalised.includes('safe'))
    return 'safe'
  return 'dangerous'
}

export async function reviewToolCall(
  request: ToolPermissionRequest,
  model: LanguageModel,
): Promise<'safe' | 'dangerous'> {
  const userMessage = SYSTEM_PROMPT
    .replace('{toolName}', request.toolName)
    .replace('{actionTitle}', request.actionTitle)
    .replace('{actionDetails}', formatDetails(request.actionDetails))

  try {
    const { text } = await generateText({
      model,
      prompt: userMessage,
    })
    return parseClassification(text)
  }
  catch {
    return 'dangerous'
  }
}
