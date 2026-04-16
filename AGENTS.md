# AGENTS.md

## Overview

This is a Tauri + Vue 3 + TypeScript application using the `ai` SDK for LLM capabilities, Pinia for state management, and Vitest for testing.

## Build Commands

```bash
# Run dev server
pnpm dev

# Full production build
pnpm build

# Type check only
pnpm typecheck

# Preview production build
pnpm preview

# Tauri commands
pnpm tauri dev
pnpm tauri build
```

## Lint & Format Commands

```bash
# Lint all files
pnpm lint

# Lint and auto-fix
pnpm lint:fix
```

## Test Commands

```bash
# Run tests in watch mode (default)
pnpm test

# Run tests once
pnpm test:run

# Run tests with coverage
pnpm test:coverage

# Run a single test file
pnpm test <filename>
pnpm test:run <filename>

# Example:
pnpm test src/utils/__tests__/highlighter.test.ts
```

## Code Style Guidelines

### General

- No semicolons (enforced by ESLint)
- Single quotes for strings (avoid escape when needed)
- Object shorthand always (`{ foo }` not `{ foo: foo }`)
- Prefer `const` over `let`, never `var`
- Arrow functions use parens only when needed: `x => x + 1` not `(x) => x + 1`
- Max 2 statements per line
- No trailing commas
- `@/` path alias for src directory: `import { foo } from '@/utils/bar'`

### Imports

- Import order is automatically handled by `@antfu/eslint-config` (perfectionist)
- Remove unused imports immediately (enforced)
- Unused variables/args must be prefixed with `_`
- Avoid `import type` unless necessary

### TypeScript

- Strict mode fully enabled
- Avoid `any` (warned)
- All interfaces/types should be explicit
- Enable all strict checks:
  - strictNullChecks
  - exactOptionalPropertyTypes
  - noUncheckedIndexedAccess
  - noFallthroughCasesInSwitch
  - noUnusedLocals
  - noUnusedParameters

### Vue Components

- File extension: `.vue`
- Block order **MUST** be: `<script>` → `<template>` → `<style>`
- PascalCase for component names in templates: `<MyComponent />` not `<my-component />`
- Define macros order: `defineOptions` → `defineProps` → `defineEmits` → `defineSlots`
- Empty line required between blocks
- Use `<script setup>` syntax
- Component files are PascalCase: `ChatMessage.vue`

### Naming Conventions

- Files: kebab-case for utilities, PascalCase for components
- Variables/functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Interfaces/Types: PascalCase
- Stores: use `useXyzStore` naming pattern
- Composables: prefix with `use`

### Error Handling

- Always handle promises with `.catch()` or try/catch
- Prefer error objects over throwing strings
- Log warnings with `console.warn` (allowed), avoid `console.log` in production
- Never swallow errors silently

### State Management (Pinia)

- Use `defineStore` with Pinia
- All stores are in `src/stores/`
- Use persisted state plugin where appropriate
- Prefer composition API syntax for stores

### Testing

- Tests located in `__tests__` directories next to source files
- Use Vitest for testing
- Use `@vue/test-utils` for component tests
- Test filenames: `<module>.test.ts`
- Mock external dependencies

### Tauri

- Rust backend in `src-tauri/`
- Use official Tauri plugins for system operations
- Never use `window.__TAURI__` directly - use `@tauri-apps/api`
- Enable strict CSP

## ESLint Rules Enforced

```text
// Core rules
'no-console': 'warn',
'style/semi': ['error', 'never'],
'style/quotes': ['error', 'single'],
'prefer-const': 'error',
'no-var': 'error',
'object-shorthand': ['error', 'always'],

// Vue rules
'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
'vue/component-name-in-template-casing': ['error', 'PascalCase'],
'vue/define-macros-order': ['error', { order: ['defineOptions', 'defineProps', 'defineEmits', 'defineSlots'] }],
'vue/padding-line-between-blocks': ['error', 'always'],
```

## Dependencies to Use

- UI: Vue 3 + Tailwind CSS v4
- State: Pinia + pinia-plugin-persistedstate
- Icons: lucide-vue-next
- AI: ai SDK (Vercel) with Anthropic, Google, OpenAI providers
- Database: Tauri SQL plugin (sqlite)
- Syntax highlighting: shiki
- Build: Vite
- Testing: Vitest + happy-dom
- Lint: @antfu/eslint-config

## Git & Hooks

- Husky pre-commit hooks run lint-staged
- Always run `pnpm lint:fix` before committing
- Commit messages should be descriptive

## Project Structure

```
src/
  components/     # Vue components (organized by feature)
  stores/         # Pinia stores
  utils/          # Utility functions
  views/          # Page components
  db/             # Database operations
  assets/         # Static assets
  styles/         # Global styles
```

## Important Notes

- This is an ESM module project (`"type": "module"` in package.json)
- Use `.ts` extensions in imports when needed
- Target ES2022
- Do not modify `src-tauri` without understanding Tauri security
- All external API calls should go through the AI SDK providers
- Avoid direct DOM manipulation - use Vue reactivity

## Editor Configuration

The project uses ESLint with auto-fix. Enable "format on save" in your editor using ESLint. Do not use Prettier directly - formatting is handled by ESLint's format plugin.

## Commit Guidelines

- Make small, focused commits
- Each commit should compile and pass tests
- Describe what changed and why
