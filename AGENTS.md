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
| `pnpm tauri build`   | Production build for current platform                            |
| `pnpm typecheck`     | `vue-tsc --noEmit`                                               |
| `pnpm lint`          | `eslint .` (also runs in CI)                                     |
| `pnpm lint:fix`      | ESLint autofix (runs via pre-commit)                             |
| `pnpm test`          | `vitest` (watch mode)                                            |
| `pnpm test:run`      | `vitest run` (CI mode)                                           |
| `pnpm test:coverage` | `vitest run --coverage` (provider `v8`)                          |

> **CI order** (`check.yml`): `lint:fix` → `lint` → `typecheck` (no tests run in CI).
> **Build workflow** (`build.yml`): multi-platform Tauri build (Ubuntu deps: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, etc.).
> Pre-commit hooks run `lint:fix` via `lint-staged` on staged `src/**/*.{ts,vue}`.

---

## Workspace

- Uses `pnpm` with `pnpm-workspace.yaml`.
- Root workspace: main Tauri + Vue app.
- The `models.dev` client is part of the app source under `src/utils/modelsdev/` and should be maintained there with the rest of the frontend code.

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
- **`src/stores/themes.ts`** — Theme store with **5 built-in themes** (abyss, terracotta, chocolate, frost, moss) + custom themes; persists to localStorage.
- **`src/db/database.ts`** — SQLite singleton + **versioned migrations** + typed query helpers. See “Gotchas / Database” below.
- **`src/skills/builtin/<skill>/SKILL.md`** — Skill definitions (YAML frontmatter + workflow instructions).
- **`src-tauri/src/lib.rs`** — Tauri command setup; registers plugins (`http`, `dialog`, `fs`, `persisted-scope`, `window-state`, `opener`, `sql`, `shell`, `os`). Also includes custom commands for `browser`, `terminal`, `glob`, and `grep`.

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

### Rules

- For the new .vue files make sure to use tailwind v4 cause most of the files are now ported to tailwind v4 EXECPT few exceptions, those files should be written with the styling that they already contain.

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
- Vue-specific rules enforced: `vue/block-order` (`script`, `template`, `style`), `vue/component-name-in-template-casing` (PascalCase), `vue/define-macros-order` (`defineOptions` → `defineProps` → `defineEmits` → `defineSlots`).

### Testing

- Test environment is `node`.
- Test glob: `src/**/*.{test,spec}.{ts,tsx}`.
- Tauri APIs are stubbed via `vitest.config.ts` aliases to `src/__mocks__/*`.

### Build artifacts

- Vite builds to `dist/` (Tauri frontend bundle).
- Rust builds in `src-tauri/target/`.
