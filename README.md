# Emty Agent

A production-grade Tauri + Vue 3 + TypeScript application powered by AI SDK for advanced LLM capabilities.

## 🚀 Overview

Emty Agent is a cross-platform desktop application that integrates various AI providers (Anthropic, Google, OpenAI) to provide a rich chat and project-based experience. It features:

- **Multi-Model Support**: Anthropic, Google, and OpenAI (including compatible providers).
- **Persistent State**: State management via Pinia with persistent storage.
- **Tauri Core**: Native desktop features using Tauri v2.
- **Syntax Highlighting**: Powered by Shiki with support for 100+ languages.
- **Modern UI**: Built with Vue 3, Tailwind CSS v4, and Lucide icons.
- **Built-in Database**: SQLite integration for conversation and message history.

## 🛠 Tech Stack

- **Frontend**: Vue 3 (Composition API, `<script setup>`), Pinia, Tailwind CSS v4, Vite.
- **Backend**: Rust (Tauri v2).
- **AI Integration**: [Vercel AI SDK](https://sdk.vercel.ai/docs).
- **Styling**: Tailwind CSS v4.
- **Linting & Formatting**: `@antfu/eslint-config` (ESLint).

## 📦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v10+)
- [Rust](https://www.rust-lang.org/) (stable)

### Installation

```bash
# Install dependencies
pnpm install
```

### Development

```bash
# Run the dev server
pnpm tauri dev
```

### Production Build

```bash
# Build the application for your current platform
pnpm tauri build
```

## 🏗 CI/CD

The project includes production-grade GitHub Actions workflows:

- **Quality Check**: Runs on every push/PR to ensure code quality via `pnpm lint` and `pnpm typecheck`.
- **Build App**: Performs multi-platform builds (Windows, macOS, Linux) to ensure stability across all targets.

## 📜 Guidelines

Refer to [AGENTS.md](./AGENTS.md) for detailed coding standards, project structure, and development guidelines.

## 📄 License

[Private / Custom] - See package.json for versioning and details.
