# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `pnpm dev`           | Vite dev server (port 1420, strictPort)         |
| `pnpm tauri dev`     | Full Tauri dev build (needs `pnpm dev` running) |
| `pnpm build`         | Type-check + production Vite build              |
| `pnpm typecheck`     | `vue-tsc --noEmit`                              |
| `pnpm lint`          | ESLint check                                    |
| `pnpm lint:fix`      | ESLint autofix (runs via pre-commit hook)       |
| `pnpm test`          | Vitest watch mode                               |
| `pnpm test:run`      | Vitest single run (CI mode)                     |
| `pnpm test:coverage` | Vitest with v8 coverage                         |

Run a single test file: `pnpm test:run src/path/to/file.test.ts`

CI order: `lint:fix` → `lint` → `typecheck` → `test:run` → `build`

## Architecture

**Tauri 2 desktop app** — Rust backend with a Vue 3 + TypeScript frontend. AI chat interface backed by local SQLite.

### Layers

- **Frontend** (`src/`): Vue 3 `<script setup>`, Pinia stores (persisted via `pinia-plugin-persistedstate`), Tailwind CSS v4.
- **Backend** (`src-tauri/`): Rust Tauri commands. The `lib.rs` registers plugins (http, dialog, fs, window-state, opener, sql, shell, os) and browser surface commands.
- **AI** (`src/utils/ai.ts`): Central execution layer using Vercel AI SDK v6. Supports Anthropic, Google, OpenAI, and OpenAI-compatible providers. Uses `streamText` with `stopWhen: isLoopFinished()` for agentic tool looping.
- **Database** (`src/db/database.ts`): SQLite singleton via `@tauri-apps/plugin-sql`. Append-only versioned migrations. Messages are persisted incrementally during streaming (`is_complete = 0` until stream finishes).

### Key data flow

1. User types in `ChatInput` → `useChatStore.sendMessage()` in `src/stores/chat/sendMessage.ts`
2. `sendMessage` dynamically imports tool providers (filesystem, shell, web, browser, MCP, skills, subagent) and permission wrappers
3. `buildPrompt()` (`src/prompts/build.ts`) assembles the system prompt with mode-specific instructions (build vs plan)
4. `streamChat()` (`src/utils/ai.ts`) streams the response, handling tool-call → tool-result cycles
5. Messages and tool events are persisted to SQLite incrementally

### Chat modes

- **build**: Full agent with file editing, shell, and all tools enabled
- **plan**: Read-only exploration and planning — no code modifications

### Tool system (`src/utils/tools/`)

Tools are created as factory functions returning AI SDK `Tool` objects:

- `filesystem.ts` / `fs/` — read, write, edit, grep, glob
- `shell.ts` — `run_command`, `git_command`, background process management
- `web.ts` — web search and fetch
- `browser.ts` — browser surface control (Tauri IPC)
- `mcp.ts` — MCP server tool integration
- `skills.ts` — built-in skill execution
- `subagent.ts` — spawns child agent tabs with their own tool sets
- `permissions.ts` — wraps tools with user-approval gates
- `questions.ts` — interactive question/answer tool for the agent
- `todos.ts` — task tracking within a conversation

### Stores (`src/stores/`)

- `chat.ts` + `chat/` — tab management, streaming, conversation state cache, sub-agent coordination
- `settings/` — provider credentials, model discovery, MCP servers, tool permissions, context caching config
- `project.ts` — active project path and context
- `themes.ts` — 20 built-in themes, persists to localStorage, applies `data-theme` to `<html>`
- `browser.ts` — browser surface state
- `history.ts`, `sidebar.ts`, `fileTree.ts`, `checkpoints.ts`

### App entry

- `src/main.ts` — Vue bootstrap: Pinia with persistedstate plugin, theme init, global error handlers
- `src/App.vue` — Root layout: `TitleBar`, `Sidebar`, three views (chat/history/projects), `SettingsModal`

## Code style

Enforced by ESLint (`@antfu/eslint-config`) + Prettier. Pre-commit hook runs `lint:fix` on staged files.

| Rule            | Value               |
| --------------- | ------------------- |
| Semicolons      | Never               |
| Quotes          | Single              |
| Indent          | 2 spaces            |
| Arrow parens    | Avoid (`as-needed`) |
| Trailing commas | `all`               |
| Line endings    | LF                  |

Vue SFC block order: `<script>` → `<template>` → `<style>`. Component names in templates use PascalCase.

TypeScript strict mode is on with `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`. Prefix unused params/vars with `_`.

## Database

- Migrations in `src/db/database.ts` — append-only `MIGRATIONS` array, never modify existing entries.
- `ensureColumns()` does defensive `ALTER TABLE` checks for backward compatibility.
- Schema: `conversations` → `messages` (with `tool_events`, `parts`, `attachments`, `cache_stats`, `mention_context`, `is_complete` columns) → `checkpoints` → `checkpoint_files`.
- FTS5 virtual table `conversations_fts` for title search with triggers for sync.

## Testing

- Vitest with `happy-dom` environment.
- Test glob: `src/**/*.{test,spec}.{ts,tsx}`
- Tauri APIs stubbed via `vitest.config.ts` aliases to `src/__mocks__/`.
