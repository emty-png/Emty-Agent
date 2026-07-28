---
name: typography-systems
description: Typography systems including font pairing, type scales, responsive typography, readability, and the three-weight system for design projects.
tags: typography, fonts, type-scale, readability, design
when_to_use: Use in design mode when setting up typography, choosing fonts, or implementing type systems
modes: design
---

Typography systems for design projects. Covers font pairing, type scales, responsive typography, and readability best practices.

---

# Type Scale

Use a multiplicative scale (1.2 or 1.25). Cap at 6–8 sizes per artifact.

- **Display**: 48–72 px
- **H1**: 32–48 px
- **H2**: 24–32 px
- **H3**: 20–24 px
- **Body**: 15–18 px
- **Small**: 13–14 px
- **Caption**: 11–12 px

## Fluid Type Scales

Use `clamp()` for responsive typography that scales smoothly between viewports:

- Display: `clamp(3rem, 5vw, 4.5rem)` — scales from 48px to 72px
- H1: `clamp(2rem, 4vw, 3rem)` — scales from 32px to 48px
- Body: `clamp(0.9375rem, 1.5vw, 1.125rem)` — scales from 15px to 18px

---

# Letter-Spacing

This is the single most-skipped rule in AI-generated design. **No exceptions.**

- Body text (14–18 px): `0` (default)
- Small text (11–13 px): `0.01em` to `0.02em` (positive)
- UI labels and button text: `0.02em`
- **ALL CAPS**: **`0.06em` to `0.1em` (required)**
- Headings 32 px+: `-0.01em` to `-0.02em`
- Display 48 px+: `-0.02em` to `-0.03em`

ALL CAPS without positive tracking looks cramped and amateur. Display text without negative tracking looks loose and weak. These two failures are the most reliable AI-slop tells.

---

# Line Height (Leading)

- Display / H1 (≥32 px): `1.0`–`1.2` (tight)
- Body (15–18 px): `1.5`–`1.6`
- Small (≤14 px): `1.5`

---

# Font Pairing

- Maximum 2 typefaces per artifact (display + body, or one variable face at multiple weights).
- Always declare a system fallback chain.
- Never set `font-family: system-ui` alone on a heading — always pair it with an intentional first choice.

## Pairing Strategies

### Serif Display + Sans Body

Best for: Editorial, publishing, luxury brands. Use `'Iowan Old Style', 'Charter', Georgia, serif` for display and `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` for body.

### Sans Display + Sans Body (Different Weights)

Best for: SaaS, dashboards, modern web apps. Use `'SF Pro Display'` for display and `'SF Pro Text'` for body, both on the system font stack.

### Mono Display + Sans Body

Best for: Developer tools, data-dense interfaces. Use `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace` for display and `-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif` for body.

---

# Line Length

Limit body copy to **50–75 characters** per line. In CSS: `max-width: 65ch` is a safe default. Use `margin-inline: auto` to center the text block.

---

# Three-Weight System

Most well-crafted UIs use exactly 3 weights:

- **Read** (400 / 450) — body copy
- **Emphasize** (510 / 550) — UI text, labels, navigation
- **Announce** (590 / 600) — headlines, buttons

Weight 700+ is rarely needed. If your design uses bold for "emphasis on emphasis," it likely lacks weight discipline elsewhere.

## Tailwind Weight Mapping

- Read: `font-normal` (weight 400)
- Emphasize: `font-medium` (weight 500)
- Announce: `font-semibold` (weight 600)

---

# Typography Patterns

## Headlines

- Display headline: Use `text-5xl font-semibold tracking-tight leading-none` (negative tracking on large display text)
- Section heading: Use `text-2xl font-semibold tracking-tight`
- Subsection: Use `text-lg font-medium`

## Body Copy

- Standard body: Use `text-base leading-relaxed`
- Lead paragraph: Use `text-lg leading-relaxed text-(--color-text-secondary)`

## Labels & Captions

- ALL CAPS label: Use `text-xs font-semibold uppercase tracking-widest` with required positive tracking
- Caption: Use `text-xs text-(--color-text-secondary)`
- Code / monospace: Use `font-mono text-sm`

---

# Readability Checklist

- [ ] Body text line height is 1.5–1.6
- [ ] Line length is 50–75 characters (use `max-width: 65ch`)
- [ ] ALL CAPS has positive letter-spacing (0.06em+)
- [ ] Display text has negative letter-spacing (-0.02em)
- [ ] Maximum 2 typefaces used
- [ ] Three-weight system followed (400, 500, 600)
- [ ] Contrast ratio meets WCAG AA (4.5:1 for body text)
