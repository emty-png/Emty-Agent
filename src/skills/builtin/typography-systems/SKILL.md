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

| Role    | Range    |
| ------- | -------- |
| Display | 48–72 px |
| H1      | 32–48 px |
| H2      | 24–32 px |
| H3      | 20–24 px |
| Body    | 15–18 px |
| Small   | 13–14 px |
| Caption | 11–12 px |

## Fluid Type Scales

Use `clamp()` for responsive typography that scales smoothly between viewports:

```css
/* Display: scales from 48px to 72px */
font-size: clamp(3rem, 5vw, 4.5rem);

/* H1: scales from 32px to 48px */
font-size: clamp(2rem, 4vw, 3rem);

/* Body: scales from 15px to 18px */
font-size: clamp(0.9375rem, 1.5vw, 1.125rem);
```

---

# Letter-Spacing

This is the single most-skipped rule in AI-generated design. **No exceptions.**

| Context                   | Letter-spacing                     |
| ------------------------- | ---------------------------------- |
| Body text (14–18 px)      | `0` (default)                      |
| Small text (11–13 px)     | `0.01em` to `0.02em` (positive)    |
| UI labels and button text | `0.02em`                           |
| **ALL CAPS**              | **`0.06em` to `0.1em` (required)** |
| Headings 32 px+           | `-0.01em` to `-0.02em`             |
| Display 48 px+            | `-0.02em` to `-0.03em`             |

ALL CAPS without positive tracking looks cramped and amateur. Display text without negative tracking looks loose and weak. These two failures are the most reliable AI-slop tells.

---

# Line Height (Leading)

| Text size             | Line height         |
| --------------------- | ------------------- |
| Display / H1 (≥32 px) | `1.0`–`1.2` (tight) |
| Body (15–18 px)       | `1.5`–`1.6`         |
| Small (≤14 px)        | `1.5`               |

---

# Font Pairing

- Maximum 2 typefaces per artifact (display + body, or one variable face at multiple weights).
- Always declare a system fallback chain.
- Never set `font-family: system-ui` alone on a heading — always pair it with an intentional first choice.

## Pairing Strategies

### Serif Display + Sans Body

Best for: Editorial, publishing, luxury brands

```css
:root {
  --font-display: 'Iowan Old Style', 'Charter', Georgia, serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
```

### Sans Display + Sans Body (Different Weights)

Best for: SaaS, dashboards, modern web apps

```css
:root {
  --font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}
```

### Mono Display + Sans Body

Best for: Developer tools, data-dense interfaces

```css
:root {
  --font-display: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  --font-body: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
}
```

---

# Line Length

Limit body copy to **50–75 characters** per line. In CSS: `max-width: 65ch` is a safe default.

```css
.prose {
  max-width: 65ch;
  margin-inline: auto;
}
```

---

# Three-Weight System

Most well-crafted UIs use exactly 3 weights:

- **Read** (400 / 450) — body copy
- **Emphasize** (510 / 550) — UI text, labels, navigation
- **Announce** (590 / 600) — headlines, buttons

Weight 700+ is rarely needed. If your design uses bold for "emphasis on emphasis," it likely lacks weight discipline elsewhere.

## Tailwind Weight Mapping

```html
<!-- Read: body copy -->
<p class="font-normal">Body text at weight 400.</p>

<!-- Emphasize: UI text, labels -->
<span class="font-medium">Label text at weight 500.</span>

<!-- Announce: headlines, buttons -->
<h1 class="font-semibold">Headline at weight 600.</h1>
```

---

# Typography Patterns

## Headlines

```html
<!-- Display headline with negative tracking -->
<h1 class="text-5xl font-semibold tracking-tight leading-none">Headline Text</h1>

<!-- Section heading -->
<h2 class="text-2xl font-semibold tracking-tight">Section Title</h2>

<!-- Subsection -->
<h3 class="text-lg font-medium">Subsection Title</h3>
```

## Body Copy

```html
<!-- Standard body -->
<p class="text-base leading-relaxed">Body text with comfortable line height for reading.</p>

<!-- Lead paragraph -->
<p class="text-lg leading-relaxed text-(--color-text-secondary)">
  Larger introductory text that draws the reader in.
</p>
```

## Labels & Captions

```html
<!-- ALL CAPS label with required positive tracking -->
<span class="text-xs font-semibold uppercase tracking-widest">Label Text</span>

<!-- Caption -->
<span class="text-xs text-(--color-text-secondary)">Caption or metadata</span>

<!-- Code / monospace -->
<code class="font-mono text-sm">const value = 42;</code>
```

---

# Readability Checklist

- [ ] Body text line height is 1.5–1.6
- [ ] Line length is 50–75 characters (use `max-width: 65ch`)
- [ ] ALL CAPS has positive letter-spacing (0.06em+)
- [ ] Display text has negative letter-spacing (-0.02em)
- [ ] Maximum 2 typefaces used
- [ ] Three-weight system followed (400, 500, 600)
- [ ] Contrast ratio meets WCAG AA (4.5:1 for body text)
