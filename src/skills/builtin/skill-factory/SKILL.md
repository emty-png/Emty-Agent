---
name: skill-factory
description: Build reusable skills, workflows, and templates
tags: skill, factory, template, workflow
---

# Skill Factory

Create reusable instruction packages that enhance the agent's capabilities for this project.

## How Skills Work

Skills are modular guidance files that extend what the agent can do. Each `SKILL.md` file maps to **one** slash command. To group related commands, put multiple `SKILL.md` files in subfolders of a single skill folder.

## Directory Structure

```
<skill-root>/
  SKILL.md          — single-command skill, invoked as /skill-<name>
  scripts/          — runnable automation (shared)
  references/       — docs loaded on demand (shared)
  assets/           — non-text resources (shared)

# Grouped commands — one folder, one slash command per SKILL.md
responsive-design/
  build/
    SKILL.md        — invoked as /build
  audit/
    SKILL.md        — invoked as /audit
```

A file at `responsive-design/build/SKILL.md` with `name: build` becomes `/build` (nested skills expose as `/<name>`). A file at `<skill-root>/SKILL.md` becomes `/skill-<name>`. No `commands:` array — one file = one command.

### SKILL.md

Required YAML frontmatter:

```yaml
---
name: skill-name
description: What the skill does
tags: keyword1, keyword2
# optional: restrict to specific modes (comma-separated)
modes: design, build
---
```

For a grouped command, the subfolder's `SKILL.md` defines its own slash command:

```yaml
---
name: build
description: Build a new component with responsive behavior
tags: responsive, css
modes: design
---
```

## Resource Directories

- **scripts/** — automation the skill can invoke
- **references/** — supplementary docs to load on demand
- **assets/** — non-text resources (images, binaries)

Reference resources in your SKILL.md by relative path (e.g., `references/checklist.md`). The agent loads them with `load_skill_resource`. Resources in the parent folder are shared by all sub-commands.

## Scope

- **Project** (default): `.emty/skills/` — only available in this project
- **Global**: `~/.emty/skills/` — available across all projects

Project skills override global skills with the same name. For grouped skills, the override key is the full sub-path (e.g. `responsive-design/build`).

## Workflow

1. Understand what the user is trying to build
2. Ask clarifying questions about scope, triggers, and resources
3. Use the `create_skill` tool to scaffold each command as its own `SKILL.md`:

```
create_skill({
  name: "responsive-design/build",
  description: "Build a new component with responsive behavior",
  tags: ["responsive", "css"],
  scope: "project",
  content: `## Workflow
1. Check container queries...
2. Use clamp() for fluid sizing...`
})

create_skill({
  name: "responsive-design/audit",
  description: "Review an existing UI against responsive anti-patterns",
  tags: ["responsive", "audit"],
  scope: "project",
  content: `## Workflow
1. Check for fixed pixel widths...
2. Verify touch targets...`
})
```

4. Walk through the created files with the user
5. Refine the content if needed

## Guidelines

- **One file per command** — never put multiple slash commands in one `SKILL.md`; create `subfolder/SKILL.md` instead
- **Be specific** — write instructions a junior developer could follow
- **Include examples** — show the expected input/output
- **Describe resources** — explain when and how to use scripts/, references/, and assets/
- **Decide scope** — use project for team-specific skills, global for personal cross-project skills
- **Group related commands** — use a parent folder (`my-feature/build`, `my-feature/audit`) to keep them discoverable
