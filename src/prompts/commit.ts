export function buildCommitPrompt(diff: string): string {
  // Protect LLM prompts from extremely large diffs — truncate to a safe size.
  const MAX_DIFF_CHARS = 14_000
  let trimmed = diff ?? ''
  let truncatedNote = ''
  if (trimmed.length > MAX_DIFF_CHARS) {
    trimmed = trimmed.slice(0, MAX_DIFF_CHARS)
    truncatedNote = `\n\n[NOTE: diff truncated to ${MAX_DIFF_CHARS} characters]`
  }

  return `You are an expert software engineer generating a professional commit message.

# The Professional Standard: Conventional Commits

The widely-adopted format in the industry is **Conventional Commits**. The structure is:

<type>(<scope>): <description>

[optional body]

[optional footer(s)]

## Type Prefixes

- \`feat\` — a new feature
- \`fix\` — a bug fix
- \`docs\` — documentation only
- \`style\` — formatting, semicolons, etc. (no logic change)
- \`refactor\` — restructuring code without changing behavior
- \`perf\` — performance improvement
- \`test\` — adding or updating tests
- \`build\` — build system or dependencies
- \`ci\` — CI/CD configuration
- \`chore\` — other maintenance (no src/test changes)
- \`revert\` — reverting a previous commit

Breaking changes are indicated with \`!\` after the type, or a \`BREAKING CHANGE:\` footer in the commit body.

## Core Rules

1. **Use imperative mood:** Write "Fix bug", not "Fixed bug".
2. **Keep the subject line short:** Aim for under 72 characters.
3. **Separate subject from body with a blank line.**
4. **Wrap body text at 72 characters.**
5. **Explain WHAT and WHY, not HOW.** The diff already shows HOW.
6. **No Markdown:** Do not wrap the output in markdown code blocks. Output raw text.

Here is the Git Diff of the staged changes (truncated if necessary):
<diff>
${trimmed}
</diff>
${truncatedNote}

Generate the commit message based on the diff above.`
}
