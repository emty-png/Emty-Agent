---
name: desktop
description: Design or review a desktop screen (~1440px) — information density, grid systems, mouse+keyboard interaction, and large-canvas hierarchy
tags: desktop, grid, density, hover, keyboard, tables, dashboards, navigation, typography, accessibility
modes: design
---

# Desktop Design

A desktop screen is a large canvas driven by a precise cursor, a rich keyboard, and a user sitting down to do work. The failure mode is the opposite of mobile: not "too cramped" but **wasted space, stretched content, and weak hierarchy**. Width is a resource — spend it on structure, not on margins.

## Use the width, don't just fill it

- Wrap content in a **max-width container** (1120–1440px, centered) on full-bleed viewports. A line of text running 1400px wide is a design bug: body copy stays at **50–75 characters** (`max-width: 65ch`) no matter how wide the screen is.
- Multi-column structure is the point of desktop: **12-column grid** for pages, 2–3 columns for content sections, side-by-side detail panes for tools. If a 1440px screen renders one stretched column, the layout is mobile thinking on the wrong canvas.
- Density is a feature. Dashboards and tools should show the information that matters **without scrolling** — above the fold is where status, KPIs, and primary actions live. Spacious marketing pages are the deliberate exception, not the default posture.
- Alternate density deliberately: one tight, data-rich section, then one breathing section. Uniform spacing across 1440px reads as unfinished.

## Layout systems

- **CSS Grid for the page skeleton** (header / sidebar / content / footer regions, card grids, table layouts), **Flexbox for rows within components**. Nested, not competing.
- Fixed-width **sidebar navigation** (220–280px) persists across app-style screens; top navigation suits marketing and content sites. Don't collapse a desktop sidebar behind a hamburger — the hamburger is a mobile pattern.
- Cards in a grid must share a consistent internal structure: same padding, same title position, same action placement. Use `repeat(auto-fit, minmax(min-content boundaries))` thinking — card columns shouldn't jump between 3 and 4 with a 1px resize.
- Panels and split views (list + detail) are the natural desktop pattern for anything where the user browses one item while keeping context (mail, settings, admin tools).

## The mouse is precise — design for it

- Hit targets can be **32–44px**; comfortable is 36–40px. Precision doesn't excuse cramp: adjacent controls still get ≥8px separation.
- **Hover is a real state, not decoration.** Row hover on tables, card elevation on hover, revealed row actions, cursor affordances (`cursor: pointer` on clickables, `text` on selectable text, `not-allowed` on disabled). Every interactive element must visibly respond on hover AND on focus.
- Never rely on hover **alone** for anything essential — keyboard and touch users still need a path (focus, tap, or explicit click).
- Tooltips are for enrichment (full text of a truncated cell, shortcut hints) — never the only way to learn what a control does.
- Right-click context menus are optional; if present they must duplicate reachable actions, never hide exclusive ones.

## The keyboard is a first-class citizen

- **Visible focus rings** on every focusable element — 3:1 contrast against adjacent surfaces, ~2px offset, never `outline: none` without a replacement.
- Logical tab order follows visual order; no focus traps in modals (Escape closes, focus returns to the trigger).
- Show shortcut hints (`⌘K`, `Esc`) in tooltips and menus where shortcuts exist. A command palette (`⌘K`) is the signature desktop power pattern for tools with many actions.
- Enter submits, Escape cancels — these defaults are expected, not optional.

## Data display (where desktop earns its keep)

- **Numbers align right and set in a monospace or tabular-nums face** — digits that shift width as they update are unreadable in a dashboard.
- Tables: sticky header, right-aligned numerics, left-aligned text, truncation with tooltip for overflow (never silent clipping), sort indicators, zebra or hover striping — pick one, not both.
- Charts and KPI tiles carry the visual weight on a dashboard — label directly on the chart instead of a detached legend where possible.
- Empty/error/loading states for every data region: skeleton rows while loading, a plain-language empty state with the primary action, an inline error with retry.

## Typography at scale

- Display sizes can go large (48–72px for marketing heroes) with tracking **-0.02 to -0.03em**; dashboard headings stay restrained (20–24px) because density is the goal.
- Base body 15–16px; secondary text 13–14px with +0.01–0.02em tracking; UI labels 13–14px at 0.02em. Nothing below 11px.
- Three weights only: 400/450 body, 500–550 UI/labels, 600 headings/buttons. Bold-plus-bold means the hierarchy elsewhere has failed.
- At 1440px, line-height 1.5–1.6 for body, 1.1–1.2 for large display. Long-form reading measure stays ≤65ch even inside wide columns.

## Spacing and hierarchy on the big canvas

- Use the token scale (4/8/12/16/24/32/48/64/96px), 6–8 tokens max. Section rhythm is generous (48–96px on marketing, 24–48px in dense tools); component padding is tight (8–16px).
- One obvious focal point per screen: the eye should land on the hero, the headline KPI, or the primary action first. If everything shouts, nothing is heard.
- One accent color, at most 2 visible uses per screen (e.g. one primary CTA + one active tab). Desktop screens fail by _under_-using neutrals, not by over-using them.

## Anti-patterns (fix before shipping)

1. **Single stretched column** on a wide viewport, or text lines exceeding ~75 characters.
2. **Hamburger-collapsed navigation** on desktop.
3. **Centered, capped everything** — a 600px card floating in 1440px of emptiness.
4. **No hover/focus states** on interactive elements.
5. **Left-aligned numbers in tables** and non-tabular digits.
6. **Uniform card grids** with identical filler content edge to edge — density without hierarchy.
7. **Dead space instead of structure** — wide gaps where a second column, summary pane, or data would serve the task.
8. **Mobile-sized touch targets and type** — desktop text below 13px and tiny 20px buttons read as a port, not a design.
