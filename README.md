# Emty Agent

A cross-platform desktop AI chat app built with Tauri 2, Vue 3, and the Vercel AI SDK.

## Overview

Emty Agent integrates multiple AI providers (Anthropic, Google, OpenAI, and compatible APIs) into a rich chat and project-based desktop experience.

- **Multi-Model Support** -- Anthropic, Google, OpenAI, and OpenAI-compatible providers.
- **Persistent State** -- Pinia with local persistence.
- **Tauri 2 Backend** -- Native desktop features via Rust.
- **Syntax Highlighting** -- Shiki with 100+ languages.
- **SQLite Database** -- Conversation and message history.
- **Modern UI** -- Vue 3, Tailwind CSS v4, Lucide icons.

## Tech Stack

- **Frontend**: Vue 3 (Composition API, `<script setup>`), Pinia, Tailwind CSS v4, Vite
- **Backend**: Rust (Tauri 2)
- **AI SDK**: [Vercel AI SDK](https://sdk.vercel.ai/docs)
- **Linting**: ESLint (`@antfu/eslint-config`), Prettier

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [pnpm](https://pnpm.io/) v10+
- [Rust](https://www.rust-lang.org/) (stable)

### Install

```bash
pnpm install
```

### Development

```bash
pnpm tauri dev
```

### Production Build

```bash
pnpm tauri build
```

## CI/CD

GitHub Actions workflows run on every push and PR:

- **Quality Check** -- `pnpm lint` and `pnpm typecheck`.
- **Build** -- Multi-platform Tauri builds (Windows, macOS, Linux).

## Guidelines

See [AGENTS.md](./AGENTS.md) for coding standards, project structure, and development conventions.

## License

Private / Custom -- see package.json for versioning and details.
