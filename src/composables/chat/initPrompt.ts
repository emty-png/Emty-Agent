/** Prompt inserted by the `/init` slash command — generates/updates the repo's `AGENTS.md`. */
export const INIT_PROMPT = `Analyse this repository and generate or update \`AGENTS.md\` at the project root.

The goal is a compact, high-signal instruction file that helps future AI agent sessions ramp up quickly and avoid common mistakes. Every sentence should answer: "Would an agent likely get this wrong without being told?" If not, leave it out.

## How to investigate

Work through the highest-value sources first:
- Root README, manifests (package.json, Cargo.toml, pyproject.toml, go.mod, build.gradle, etc.), workspace config, lockfiles
- Build, test, lint, formatter, typecheck, and codegen config
- CI workflows (.github/workflows/, .gitlab-ci.yml, Makefile, Taskfile, etc.) and pre-commit / task-runner config
- Any existing instruction files: AGENTS.md, CLAUDE.md, .cursor/rules/, .cursorrules, .github/copilot-instructions.md
- A small number of representative source files to understand how the system is wired together — prefer entrypoints, routers, and bootstrap files over random leaf files

Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source.

## What to extract

Capture only the facts that require reading multiple files to infer:

**Commands**
- Exact commands for: dev server, build, test (full suite and single test), lint, typecheck, format, codegen, database migrations, deploy
- Non-obvious flags, required environment variables, or setup steps that must happen first
- Required ordering when it matters: e.g. "always run lint before typecheck before test"

**Architecture**
- Monorepo or multi-package structure: which directories own which concerns, real app entrypoints
- How the major pieces connect: API layer, data layer, background jobs, frontend/backend split
- Any generated code, build artifacts, or files that must never be edited by hand

**Toolchain & framework quirks**
- Non-default framework conventions or config that differ from what an agent would assume
- Special environment loading (dotenv files, secret managers, feature flags)
- Codegen or migration workflows that must be run after schema/model changes

**Testing**
- How to run a single test or a single package in isolation
- Required services, fixtures, or databases before tests can run
- Expensive, flaky, or integration-only test suites — and how to skip them during dev

**Style & conventions**
- Linting and formatting rules that differ from the language default (e.g. no semicolons, tabs vs spaces, import order)
- Naming conventions, file structure expectations, or PR/commit conventions worth preserving

## Questions

Only ask the user questions if the repository genuinely cannot answer something important. Use the questions tool for a single short batch at most.

Good reasons to ask:
- Undocumented team conventions or branch/PR/release expectations
- Missing setup steps or test prerequisites that are known but not written anywhere

Do not ask about anything the repository already makes clear.

## Writing rules

- Use short sections and bullet points — keep it scannable
- Include exact commands, not paraphrases
- Architecture notes should explain non-obvious wiring, not describe what files exist
- Omit generic advice, tutorials, exhaustive file trees, and anything speculative
- If the repo is simple, keep the file simple. If it is large, summarise the few structural facts that actually change how an agent should work

If \`AGENTS.md\` already exists at the root, improve it in place. Preserve verified, useful guidance. Remove fluff, stale claims, and anything contradicted by the current codebase. Reconcile it with what you actually find.\
`
