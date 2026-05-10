---
name: skill-factory
description: Create production-ready SKILL.md packages and supporting resources when the user wants new reusable agent capabilities, skill systems, or skill authoring workflows.
tags: skill, skills, skill factory, skill system, skill authoring, SKILL.md, agent capability, reusable instructions
---

This skill creates reusable agent skills as structured packages instead of one-off prompt text.

## Goal

Turn raw documentation, user intent, API notes, or workflow knowledge into a production-ready skill package the agent can discover and reuse later.

## Skill Package Layout

Create project skills under:
`.emty-agent/skills/<skill-slug>/SKILL.md`

Optional supporting resources live beside it:

- `.emty-agent/skills/<skill-slug>/scripts/`
- `.emty-agent/skills/<skill-slug>/references/`
- `.emty-agent/skills/<skill-slug>/assets/`

## Authoring Standard

Every SKILL.md should include:

1. YAML frontmatter with at least:
   - `name`
   - `description`
   - `tags`
2. A concise body that explains:
   - when to use the skill
   - when not to use it
   - the expected workflow
   - resource files to load only when needed

## Factory Workflow

1. Gather the source material first: docs, examples, conventions, APIs, edge cases.
2. Distill it into reusable operating instructions instead of copying raw docs.
3. Make the skill narrow and opinionated enough to be reliably invoked.
4. Write a "pushy" description so the agent does not under-trigger the skill.
5. Keep the SKILL.md body concise and offload large details to `references/`.
6. Put runnable automation or repetitive logic into `scripts/`.
7. Add assets only when they materially improve delivery.

## Quality Bar

- The skill should solve one family of tasks well.
- Instructions should be actionable, not vague theory.
- The skill should do what its name and description promise, no more and no less.
- Avoid duplicating repository-wide rules that already belong in AGENTS.md.
- Prefer durable conventions over task-specific temporary notes.
- If the skill depends on a reference document, say exactly when to load it.
