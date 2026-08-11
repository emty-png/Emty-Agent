import type { LanguageModel } from 'ai'
import type { ToolPermissionRequest } from './permissions'
import { generateText } from 'ai'

const SYSTEM_PROMPT = `You are a strict security classifier for an autonomous AI coding agent running on a user's local machine.
Your job is to evaluate tool calls and determine if they are SAFE to execute automatically, or DANGEROUS and require explicit user approval.

SAFE (Auto-approve):
- Reading files, listing directories, searching code (grep, glob, rg).
- Asking the user questions, creating/updating tasks, saving memories.
- Writing or editing files STRICTLY INSIDE the current project workspace.
- Non-destructive git commands: status, log, diff, add, commit, branch.
- Starting local dev servers, taking screenshots, running tests, linting, formatting.
- Spawning sub-agents for read-only or project-scoped tasks.

DANGEROUS (Require User Approval):
- DELETING files or directories (rm, rmdir, del, Remove-Item, git clean).
- Discarding uncommitted work (git checkout ., git restore, git reset --hard).
- Moving/renaming files OUTSIDE the project root.
- Force operations: git push -f, git push --force, git rebase.
- Build/Publish/Deploy commands: npm publish, cargo publish, docker push, make deploy.
- Executing arbitrary scripts from the internet (curl | sh, wget | bash, npx unknown-package).
- Modifying system configuration, global git config, or SSH keys.
- Any command that could cause irreversible data loss, financial cost, or system damage.
- Network requests to unknown external hosts or exfiltrating data.

Evaluate the following tool call:
Tool: {toolName}
Action: {actionTitle}
Details: {actionDetails}

Respond with EXACTLY one word: SAFE or DANGEROUS. Do not include any other text, punctuation, or explanation.`

function formatDetails(details: string[]): string {
  if (!details || details.length === 0)
    return 'No additional details provided.'
  return details.join('\n')
}

/**
 * Strictly parse the LLM response.
 * Defaults to 'dangerous' on ANY ambiguity to ensure fail-safe security.
 */
function parseClassification(text: string): 'safe' | 'dangerous' {
  // Strip all non-alphabetic characters and lowercase for strict matching
  const normalised = text.trim().toLowerCase().replace(/[^a-z]/g, '')

  if (normalised === 'safe')
    return 'safe'

  // Fail closed: 'dangerous', 'unsafe', 'notsafe', or any unparseable garbage
  // all default to 'dangerous' to require explicit user approval.
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
      temperature: 0, // Deterministic output for classification
      abortSignal: AbortSignal.timeout(100_000), // 100s hard timeout to prevent hanging
    })

    return parseClassification(text)
  }
  catch (error) {
    // Fail closed on network errors, timeouts, or model failures
    console.error('[SecurityClassifier] Classification failed, defaulting to DANGEROUS.', error)
    return 'dangerous'
  }
}
