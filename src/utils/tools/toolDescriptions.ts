export const DEFAULT_TOOL_DESCRIPTIONS = {
  read_files: `Read one or more text files from the project. Returns content with 1-based line numbers in cat -n format.

Always call read_files and wait for its result before calling edit_files or write_file on the same file. Calling read and write in parallel on the same file path is not allowed. Reading and writing different file paths in parallel is fine.

If a file is truncated, use offset + limit to read subsequent pages. Read all pages before writing. Default limit: 300 lines, max: 2000.`,

  edit_files: `Apply one or more search-and-replace edits to existing files. Edits for each file are applied in order; if one fails, all edits for that file are rolled back.

Always call read_files and wait for its result before editing a file. Calling read and edit in parallel on the same file path is not allowed. Reading one file while editing a different file is fine.

Prefer this tool over write_file for modifying existing files.

Rules:
- old_string must exactly match the target text, including whitespace and indentation.
- old_string must be unique within the file. If it matches multiple locations, expand it to include more context.
- Set replace_all: true to replace every occurrence intentionally.
- To create a new file, use old_string: "" on a path that does not exist yet.`,

  write_file: `Write or overwrite a text file within the project. Creates the file if it does not exist; fully replaces it if it does.

Always call read_files and wait for its result before overwriting or appending to an existing file. Calling read and write in parallel on the same file path is not allowed. Reading one file while writing a different file is fine.

Prefer edit_files for targeted changes to existing files. Use this tool only for new files or full rewrites.

For very large files, write in chunks: first call creates the file (append: false), subsequent calls use append: true. Text files only — not for binary files, renames, deletes, or permission changes.`,

  list_directory: 'Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.',

  glob: `Find files and directories by glob pattern. Respects .gitignore by default.

Use when you need to locate files without knowing their exact path.
Supports *, **, ?, {a,b}, [abc] patterns.
Results are sorted: directories first, then files, both alphabetically.
Hidden dotfiles and gitignored files are excluded by default.`,

  grep: `Search file contents with a text or regex pattern. Respects .gitignore by default.

- Literal search by default — pass regex: true for regex syntax
- Case-sensitive by default — pass case_sensitive: false for case-insensitive
- Filter by file name pattern with glob (e.g. "*.ts", "src/**/*.js")
- Use files_only: true to get just file paths without match content
- Add context lines around matches with context_lines (0-5, default 1)
- For cross-line patterns use multiline: true`,

  ask_questions: `Ask the user clarifying questions before proceeding with a complex or ambiguous task.

WHEN TO USE:
- Use ONLY when missing information will fundamentally change your implementation approach, architecture, or file structure.
- Use when multiple valid architectural paths exist and you cannot confidently choose one without user preference.

WHEN NOT TO USE:
- NEVER use this if you can find the answer by reading the codebase, checking configuration files, or reading documentation.
- NEVER use this for trivial decisions, styling choices, or standard best practices. Make a reasonable professional assumption instead.
- NEVER ask yes/no questions where the answer is obvious.

EXECUTION RULES:
1. Batch ALL related questions into a SINGLE tool call. The maximum is 5 questions per batch. Do not call this tool multiple times for the same task.
2. Provide 2 to 4 highly distinct, mutually exclusive options for each question. Order them from most recommended to least recommended.
3. The UI automatically appends a free-text "Other" option, so do not include "Other" or "Custom" in your options array.
4. Use the "dependsOn" field to conditionally show follow-up questions based on a prior answer. This keeps the UI clean and relevant.

AFTER RECEIVING ANSWERS:
- Treat "skipped" or "skipped (condition not met)" as "no preference — use your best professional judgment".
- Once you receive the answers, acknowledge them briefly and immediately proceed with the task. Do not ask more questions.`,

  create_task: `Create a new task and add it to the task list.

Always create tasks to track progress for multi-step or non-trivial work.
Create all expected tasks before starting execution so the user sees the full plan.
Use a clear imperative subject and a complete description.
Do not create tasks for trivial single-step actions.
Return the new task ID.`,

  update_task: `Update one existing task by its task ID.

Always mark the status of the task correctly.
Set status to "in_progress" immediately before starting work on the task.
Set status to "completed" immediately after the task is fully done.
Use "deleted" only when the task is no longer needed.
Call list_tasks first if you are unsure of task IDs or current status.
Update subject, description, or activeForm only when the task details have changed.
Return the result of the update.`,

  list_tasks: `List all current tasks with their IDs and statuses.

Always call this before updating tasks if you are unsure of the current task list.
Use this to keep task state accurate and avoid duplicate, stale, or orphaned tasks.
This operation is cheap and does not access the filesystem.`,

  get_task: `Retrieve the full details of one task by its task ID.

Use this when you need the complete description, activeForm, or current status of a specific task.
Do not use this to list all tasks; use list_tasks for that purpose.`,

  plan: 'Write or replace a production-quality implementation plan for the user to review before modifying files. The plan is saved to ~/.emty/plans/<project_name>/<planName>.md and the result includes a unified diff plus added/removed line counts. Use concise but complete markdown with scope, constraints, affected files, implementation steps, validation, rollback or risk notes, and explicit acceptance criteria.',

  sleep: `Pause execution for a specified duration. Use when you need to wait — for example, after starting a background server, before checking if a service is ready, or to space out retry attempts.

Do NOT use for long waits when you could poll with action: "status" instead. This tool blocks your execution for the full duration.`,

  spawn_subagent: `Spawn a focused sub-agent in its own tab to handle a specific part of the current task.
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
  • Any investigation that would otherwise require many file reads or long command/debug loops in the parent context

WHEN NOT TO USE:
  • Simple single-step lookups — use the tool directly instead
  • When you already have enough context — do the work yourself
  • Recursive spawning is not allowed

ISOLATION:
  • General and debugger sub-agents may run inside an isolated git worktree when the project supports it.
    Use them freely for risky or high-churn work instead of keeping everything in the parent workspace.`,

  remember_memory: `Save a durable memory that MUST persist across future chats and sessions.

CRITICAL RULES:
1. ALWAYS call list_memories first to ensure you are not creating a duplicate.
2. NEVER store secrets, API keys, passwords, PII, or temporary debugging notes.
3. ALWAYS provide a stable, descriptive key in slug format (e.g., "prefer-single-quotes", "db-schema-users").

TWO KINDS OF MEMORY:
- "preference": User-stated rules, habits, or workflow choices (e.g., "Always use pnpm", "Prefer functional components"). Usually "global" scope.
- "note": Project facts, patterns, conventions, or architectural decisions discovered in the codebase (e.g., "Auth uses NextAuth", "Tests are in __tests__"). Usually "project" scope.

SCOPES:
- "global": Applies to all projects and workspaces for this user.
- "project": Applies only to the current repository/workspace.`,

  update_memory: `Update an existing memory entry by its exact key.

ALWAYS call list_memories first to retrieve the exact key and current content.
Use this to refine, correct, or expand upon an existing memory without deleting and re-creating it.
If the memory is completely obsolete, use forget_memory instead.`,

  forget_memory: `Permanently delete a previously saved memory by its exact key.

ALWAYS call list_memories first to confirm the key exists and to ensure you are deleting the correct entry.
Use this when a user explicitly retracts a preference, or when a project fact becomes completely obsolete and incorrect.`,

  list_memories: `List all stored memories, grouped by scope and kind, along with storage budget status.

ALWAYS call this tool BEFORE using remember_memory, update_memory, forget_memory, or consolidate_memories.
You must verify existing entries to prevent duplicates and to obtain the exact keys required for updates or deletions.
This operation is cheap and does not consume significant context.`,

  consolidate_memories: `Merge and compress multiple memories of the same scope and kind into a single concise summary.

WARNING: This operation DELETES all existing memories of the specified scope and kind, and replaces them with your summary.
ONLY use this when list_memories shows the budget is near capacity (e.g., >80% full) or when there is massive redundancy.
You MUST call list_memories first, read all the entries carefully, and ensure your summary captures ALL essential information without losing critical context.`,

  load_skill: `\
Load a skill package on demand when the current task matches one of the available skills listed in the system prompt.

Use this BEFORE following skill-specific instructions. The result includes:
- the skill metadata
- the full SKILL.md body
- any packaged resources under scripts/, references/, or assets/

Do not call this speculatively for every task. Only load the skill that clearly matches the user's request.`,

  load_skill_resource: `\
Load a specific resource from a previously loaded skill package.

Use this only when SKILL.md points you to a file in scripts/, references/, or assets/.
Text resources are returned inline. Non-text assets return their path metadata only.`,

  create_skill: `\
Create a new skill package with a SKILL.md file and optional resource directories.

Use this when the user asks you to create, build, or scaffold a new skill.
The skill becomes available immediately after creation — no restart needed.

Scope:
- "project" (default) creates the skill in the current project's .emty/skills/ directory.
- "global" creates the skill in ~/.emty/skills/ so it is available across all projects.`,

  web_search: `Search the web for current information. Use for docs, package versions, changelogs, error messages, CVEs, or anything that may have changed since training.

Batch up to 5 queries per call — group related searches rather than making separate calls.
Returns per-result title, URL, snippet, and date.
Don't search for things you already know. Use filesystem tools for file/directory lookups.`,

  web_fetch: `Fetch and extract readable text from web pages via Jina Reader (no key required). Returns clean markdown — ads and navigation stripped.

Batch up to 10 URLs per call; all fetched concurrently. Use to read a search result in full, fetch official docs, or inspect a GitHub issue, PR, or release page. Won't work for pages that require login.`,

  browser_open: `\
Open a URL inside the built-in Emty Agent browser for the current chat tab.
This browser is embedded inside the app, not an external window, and is isolated per chat tab/browser tab.

Use this when you need a real browser page the agent can later inspect or interact with.
If the input is a plain domain like "vuejs.org", https:// is added automatically.
If the input looks like a search query, it is opened as a DuckDuckGo search.`,

  browser_tabs: `\
Manage the browser tabs that belong to the current chat tab.
Use this to list open browser tabs, create a blank one, switch tabs, or close one.`,

  browser_read: `\
Read structured information from the currently active embedded browser page.
Always call this after browser_open or browser_act to verify the page state before proceeding.
Use mode="snapshot" first to understand the page layout before targeting specific elements.
Use mode="element" only when you already know the selector or visible text of your target.`,

  browser_act: `\
Interact with the currently active embedded browser page.
Supports clicking, typing, pressing a key, scrolling, and waiting for UI conditions.

IMPORTANT: Always take a snapshot first (browser_read mode="snapshot") so you know what
selectors and visible text are available. If an element is not found, re-read the page -
the DOM may not have loaded yet. Prefer CSS selectors over text matching when stable.

For press: use plain key names ("Enter", "Escape", "Tab", "ArrowDown") or modifier combos
like "Ctrl+A", "Ctrl+C", "Meta+R". Modifier prefixes: Ctrl, Alt, Shift, Meta.`,

  browser_history: `\
Move backward or forward within the current browser tab's history, or reload the page.

back/forward use the browser's native history stack, so they work for any in-page
navigation (link clicks, form submits, JS pushState) - not only URLs opened via browser_open.`,

  browser_screenshot: `\
Capture a screenshot of the currently active browser page.
Returns a base64-encoded PNG that you can analyse to understand the visual state of the page
(layout, rendered content, CAPTCHA, login walls, etc.).
When a project is open, the PNG is also saved to that project's root folder and the saved path is returned.

Use this when browser_read does not give you enough context about the visual state.
This is a best-effort in-page capture, so sites with strict rendering or security rules may return a degraded image or fail.`,

  browser_execute: `\
Execute arbitrary JavaScript in the current browser page and return the result.

Use this for operations that the standard browser_act / browser_read tools cannot express:
reading computed DOM state, manipulating localStorage/sessionStorage, triggering custom events,
extracting deeply nested data, or calling page-defined JS APIs.

The script runs in the page's main frame. Promises are awaited automatically.
The return value must be JSON-serialisable (objects, arrays, primitives). DOM nodes are not serialisable.

Example: "return document.querySelectorAll('a').length" - returns number of links.
Example: "return localStorage.getItem('token')" - reads a storage value.`,

  browser_cookies: `\
Get, set, or delete cookies for the current browser page origin.

- get: returns the cookies visible to page JavaScript for the active page URL.
- set: creates or overwrites a cookie. domain is inferred from the active page when omitted.
- delete: removes cookies matching a URL and optional name. Omit name to clear all cookies for that URL.

Useful for injecting auth tokens, reading session state, or cleaning up between tests.
Note: this does not expose HTTP-only cookies because the browser page itself cannot read them.`,

  browser_logs: `\
Retrieve and optionally clear the console logs of the currently active browser page.
Intercepts console.log, console.warn, console.error, console.info, etc.
Useful for debugging page errors or extracting logged information.`,

  run_command: `Run a shell command in the project directory.

Use is_background: true for long-running processes (dev servers, watchers) — returns immediately.
Large output (>500 lines) is automatically truncated (tail kept) and saved to a log file.
Working directory persists across commands via the cwd parameter.

Examples:
- { command: "pnpm build" }
- { command: "curl http://localhost:8000" }
- { command: "pnpm dev", is_background: true }
- { command: "ls", cwd: "src" }`,

  git_command: `Production-grade git runner.

For normal execution, omit action and pass command or commands.
String commands are allowed, so "status --short" is valid.
Use action: "status", "kill", or "list" to inspect or stop tracked tasks from either git_command or run_command.

Examples:
- { command: "status --short" }
- { commands: ["status --short", "diff --stat"] }
- { commands: [{ args: ["commit", "-m", "feat: add hero"] }] }
- { action: "status", id: "cmd4" }`,

  create_image: `Generate images from a text description using AI image generation models.

The agent provides a prompt describing the image to generate. Images are saved as PNG files in the project workspace.

Optional parameters:
- path: Directory or filename to save the image(s). If omitted, saves to the project root.
- count: Number of images to generate (1-4, default 1).
- size: Image dimensions as "WIDTHxHEIGHT" (e.g. "1024x1024"). Default varies by provider.`,

  start_project: `Create a new design project and start its live preview.

Call this FIRST, before any other design tool. It creates a project at ~/.emty/designs/{name}/ containing three files:
- index.html — links styles.css and script.js
- styles.css
- script.js

The preview renders index.html in the canvas immediately (phone/desktop toggle available). A console capture is active: anything logged via console.* or runtime errors appears in the preview console.

Rules:
- Choose a short, descriptive snake_case name (e.g. "login_page", "dashboard_v2").
- If a project with that name exists, pick a different name or pass overwrite: true to replace it.
- After creating, use edit_design to write your actual code into the three files.`,

  edit_design: `Edit files in the current design project. Only index.html, styles.css and script.js exist.

Rules:
- Provide the FULL new content for each file you change — there is no partial patching.
- Only send files that actually change; unchanged files are skipped automatically.
- Keep index.html linking "./styles.css" and "./script.js" so the preview stays wired up.
- The preview reloads automatically after a successful edit. If it ever looks stale, call refresh_preview.
- After editing, check get_console if something may have gone wrong at runtime.`,

  refresh_preview: `Reload the live preview of the current design project.

Use this only when the preview did not auto-refresh after edit_design, or when you suspect it is showing stale content. Takes no parameters.`,

  get_console: `Read the console output captured from the preview (console.log/info/warn/error/debug plus uncaught errors and promise rejections).

Use this to debug runtime problems: read the errors, fix the code with edit_design, then verify again.

Parameters:
- level: filter by "log", "info", "warn" or "error" (default "all").
- limit: max entries returned, oldest first (default 50, max 200).`,

  read_design: `Read one or more files from the current design project (index.html, styles.css, script.js). Returns content with 1-based line numbers in cat -n format.

Use this to inspect the current state of your design files before rewriting them with edit_design.

If a file is truncated, use offset + limit to read subsequent pages. Default limit: 300 lines, max: 2000.`,
} as const

export type ToolId = keyof typeof DEFAULT_TOOL_DESCRIPTIONS

export function applyDescriptionOverrides<T extends Record<string, { description?: string }>>(
  tools: T,
  overrides: Record<string, string>,
): T {
  if (Object.keys(overrides).length === 0)
    return tools
  return Object.fromEntries(
    Object.entries(tools).map(([id, t]) => [
      id,
      overrides[id] !== undefined ? { ...t, description: overrides[id] } : t,
    ]),
  ) as T
}
