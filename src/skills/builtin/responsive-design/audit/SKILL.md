---
name: audit
description: Review an existing UI against responsive-design anti-patterns and a testing checklist
tags: responsive, css, layout, mobile, breakpoints, container-queries, viewport, touch-targets, accessibility, fluid-typography
modes: design
---

# Responsive Audit

Responsive UI is not "shrink the desktop layout until it fits a phone." It's designing from the content and the available space outward, so the same interface holds up whether it's rendered in a 320px phone window, a folded/unfolded foldable, or a 3400px ultrawide — and whether the input is a finger, a mouse, or a keyboard. Treat this as a first-class constraint from the first line of CSS, not a pass done at the end.

## Mental model: content-out, not device-out

Don't design for "iPhone," "iPad," "desktop." Design for the content: at what width does _this_ paragraph, card, or nav actually start to feel cramped or wasteful? That's the breakpoint — not a device's screen size. Devices change every year; content proportions don't.

- Default to **mobile-first**: write the single-column, minimum-viable layout first, then add complexity with `min-width` media queries as space becomes available.
- Let a **component** decide its own breakpoints independent of the page (see Container queries) — a card should look right whether it's alone in a hero or squeezed into a three-column grid, without knowing which.
- Never hardcode a breakpoint to match a specific device model (`@media (max-width: 375px) /* iPhone SE */`). Pick round numbers based on where the content breaks, not a device catalog.

---

## Reviewing what already exists

### Reflow isn't just resizing — check functionality too

A layout that visually fits a narrow screen but silently drops functionality has failed:

- **Navigation** — is everything reachable on desktop reachable on mobile, not just collapsed into an undiscoverable icon?
- **Tables** — wide data tables need an explicit strategy (scroll affordance, card transform, column priority) rather than silent overflow.
- **Forms** — multi-column layouts should stack to single-column without losing label-to-input association.
- **Modals/overlays** — centered floating panels that assume desktop margins often clip or become unreachable on small screens.

### Anti-patterns (fix before shipping)

1. **Fixed pixel widths** on containers instead of `max-width` + fluid inline sizing.
2. **Device-named breakpoints** (`/* iPhone 12 */`) — ages immediately.
3. **`user-scalable=no`** or a `maximum-scale` — accessibility violation.
4. **Hover-only interactions** with no touch/focus equivalent.
5. **`100vh` hero sections on mobile** with no `dvh`/`svh` fallback.
6. **Images with no intrinsic size** — the layout-shift-on-load problem.
7. **Sub-16px form inputs** — triggers unwanted iOS zoom-on-focus.
8. **Touch targets under 44px**, especially packed tightly in mobile nav bars or icon rows.
9. **JS-computed layout** for things CSS already solves via container queries, `clamp()`, or Grid/Flexbox.
