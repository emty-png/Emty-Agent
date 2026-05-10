# AGENTS.md — Emty Agent

A Tauri 2 desktop app (Rust backend + Vue 3 + TypeScript frontend). AI chat interface with a local SQLite database, skill system, and theme engine.

---

## Tech stack

| Layer       | Technology                                                                               |
| ----------- | ---------------------------------------------------------------------------------------- |
| Frontend    | Vue 3 (script setup), TypeScript, Vite, Pinia (persisted), Tailwind CSS v4, Lucide icons |
| Backend     | Tauri 2 (Rust), SQLite via `tauri-plugin-sql`                                            |
| AI SDK      | `ai` + provider SDKs (OpenAI, Anthropic, Google, OpenAI-compatible)                      |
| Packages    | `zod`, `shiki`, `mermaid`, `devicon`, `gpt-tokenizer`                                    |
| Testing     | Vitest, `vue-test-utils`, `happy-dom`                                                    |
| Lint/Format | ESLint (`@antfu/eslint-config` + `eslint-plugin-format`), Prettier                       |
| Hooks       | Husky pre-commit -> `lint-staged`                                                        |

---

## Developer commands

| Command              | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `pnpm install`       | Install dependencies                                             |
| `pnpm dev`           | Vite dev server (port **1420**, `strictPort: true`)              |
| `pnpm build`         | `vue-tsc --noEmit && vite build`                                 |
| `pnpm tauri dev`     | Tauri dev build (needs `pnpm dev` running first or concurrently) |
| `pnpm typecheck`     | `vue-tsc --noEmit`                                               |
| `pnpm lint`          | `eslint .` (also runs in CI)                                     |
| `pnpm lint:fix`      | ESLint autofix (runs via pre-commit)                             |
| `pnpm test`          | `vitest` (watch mode)                                            |
| `pnpm test:run`      | `vitest run` (CI mode)                                           |
| `pnpm test:coverage` | `vitest run --coverage` (provider `v8`)                          |

> **CI order**: `lint:fix` → `lint` → `typecheck` → `test:run` → `build` (see `.github/workflows/ci.yml`).
> Pre-commit hooks run `lint:fix` via `lint-staged` on staged `src/**/*.{ts,vue}`.

---

## Monorepo/workspace

- Uses `pnpm` with `pnpm-workspace.yaml`.
- Root workspace: main Tauri + Vue app.
- `Emty models/`: standalone TypeScript library for `models.dev` database (not part of the app).

---

## Tauri dev setup

- Requires Rust toolchain + `tauri` CLI (`pnpm tauri`).
- Vite `server.port` is forced to **1420**. If busy, the dev server will fail (not auto-skip).
- `TAURI_DEV_HOST` enables HMR on port **1421** (via `host` and `hmr` config).
- Vite **ignores `src-tauri/`** to prevent rebuild loops.
- `clearScreen: false` so Rust error output is not cleared.
- Tauri config: `decorations: false` (frameless), window starts `visible: false`.

---

## Entrypoints & architecture

- **`src/main.ts`** — Vue bootstrap: `createApp`, Pinia with `pinia-plugin-persistedstate`, theme init, global error/rejection handlers.
- **`src/App.vue`** — Root layout: `TitleBar`, `Sidebar`, three views (`chat` | `history` | `projects`), `SettingsModal`.
- **`src/stores/themes.ts`** — Theme store with **20 themes**; persists active theme to localStorage. Applies `data-theme` to `<html>` and updates `theme-color` meta.
- **`src/db/database.ts`** — SQLite singleton + **versioned migrations** + typed query helpers. See “Gotchas / Database” below.
- **`src/skills/builtin/<skill>/SKILL.md`** — Skill definitions (YAML frontmatter + workflow instructions).
- **`src-tauri/src/lib.rs`** — Tauri command setup; registers plugins (`http`, `dialog`, `fs`, `window-state`, `opener`, `sql`, `shell`, `os`).

---

## Gotchas

### Database (SQLite)

- Migrations are versioned via `schema_version` table.
- **Add new `MIGRATIONS` entries only to the end** — never alter existing ones.
- The migration runner also performs defensive `ALTER TABLE` checks for backward compatibility (columns: `created_at`, `tool_events`, `parts`, `attachments`, `cache_stats`, `mention_context`).

### Context & skills

- The app auto-detects **`AGENTS.md`** and **`DESIGN.md`** in the user’s project directory and injects them into the system prompt.
- `MAX_CONTEXT_CHARS` truncates injected context at ~18k characters; keep `AGENTS.md` concise.
- Built-in skills live in `src/skills/builtin/<skill-name>/SKILL.md` with YAML frontmatter.

### Style / lint

| Rule            | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| Semicolons      | Never (`semi: false`)                                                |
| Quotes          | Single                                                               |
| Indent          | 2 spaces                                                             |
| Arrow parens    | Avoid (`as-needed`)                                                  |
| Trailing commas | `all`                                                                |
| Line endings    | LF (`endOfLine: "lf"`)                                               |
| Console         | `warn` (not error)                                                   |
| Strict TS       | `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` |

- Pre-commit (`lint-staged`) runs `eslint` on `src/**/*.{ts,vue}` and `prettier --write` on `src/**/*.{css,json,md}`.
- ESLint ignores: `dist`, `src-tauri`, `coverage`, `node_modules`, `*.d.ts`, `vite.config.*`.

### Testing

- Test environment is `happy-dom`.
- Test glob: `src/**/*.{test,spec}.{ts,tsx}`.
- Tauri APIs are stubbed via `vitest.config.ts` aliases to `src/__mocks__/*`.

### Build artifacts

- Vite builds to `dist/` (Tauri frontend bundle).
- Rust builds in `src-tauri/target/`.
