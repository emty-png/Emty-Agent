---
name: skill-factory
description: Build reusable skills, workflows, and templates
tags: skill, factory, template, workflow
---

# Skill Factory

Create reusable instruction packages that enhance the agent's capabilities for this project.

## How Skills Work

Skills are modular guidance files that extend what the agent can do. Each skill is a directory containing a `SKILL.md` file and optional resources.

## Directory Structure

```
<skill-root>/
  SKILL.md          — definition (YAML frontmatter + markdown body)
  scripts/          — runnable automation
  references/       — docs loaded on demand
  assets/           — non-text resources
```

### SKILL.md

Required YAML frontmatter:

```yaml
---
name: skill-name
description: What the skill does
tags: keyword1, keyword2
---
```

Optional frontmatter for multi-command skills:

```yaml
---
name: git-workflow
description: Git workflow automation
tags: git, commit, branch
commands:
  - name: commit
    description: Create a conventional commit
  - name: branch
    description: Create a feature branch
---
```

When `commands` is defined, each command becomes a separate slash command in the dropdown (e.g., `/commit`, `/branch`). When omitted, the skill is invoked as `/skill-<name>`.

## Resource Directories

- **scripts/** — automation the skill can invoke
- **references/** — supplementary docs to load on demand
- **assets/** — non-text resources (images, binaries)

Reference resources in your SKILL.md by relative path (e.g., `references/checklist.md`). The agent loads them with `load_skill_resource`.

## Scope

- **Project** (default): `.emty/skills/` — only available in this project
- **Global**: `~/.emty/skills/` — available across all projects

Project skills override global skills with the same name.

## Workflow

1. Understand what the user is trying to build
2. Ask clarifying questions about scope, triggers, and resources
3. Use the `create_skill` tool to scaffold the skill:

```
create_skill({
  name: "api-review",
  description: "Review REST API design and implementation",
  tags: ["api", "review", "rest"],
  scope: "project",
  content: `## Workflow
1. Read the API route definitions
2. Check for REST conventions...`,
  commands: [
    { name: "review-endpoint", description: "Review a single endpoint" },
    { name: "review-api", description: "Review the entire API surface" }
  ]
})
```

4. Walk through the created files with the user
5. Refine the content if needed

## Guidelines

- **Be specific** — write instructions a junior developer could follow
- **Include examples** — show the expected input/output
- **Describe resources** — explain when and how to use scripts/, references/, and assets/
- **Decide scope** — use project for team-specific skills, global for personal cross-project skills
- **Use commands** — expose multiple related operations as separate slash commands
