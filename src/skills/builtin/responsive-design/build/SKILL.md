---
name: build
description: Build a new component or page with responsive behavior designed in from the start
tags: responsive, css, layout, mobile, breakpoints, container-queries, viewport, touch-targets, accessibility, fluid-typography
modes: design
---

# Responsive Build

Responsive UI is not "shrink the desktop layout until it fits a phone." It's designing from the content and the available space outward, so the same interface holds up whether it's rendered in a 320px phone window, a folded/unfolded foldable, or a 3400px ultrawide — and whether the input is a finger, a mouse, or a keyboard. Treat this as a first-class constraint from the first line of CSS, not a pass done at the end.

## Mental model: content-out, not device-out

Don't design for "iPhone," "iPad," "desktop." Design for the content: at what width does _this_ paragraph, card, or nav actually start to feel cramped or wasteful? That's the breakpoint — not a device's screen size. Devices change every year; content proportions don't.

- Default to **mobile-first**: write the single-column, minimum-viable layout first, then add complexity with `min-width` media queries as space becomes available.
- Let a **component** decide its own breakpoints independent of the page (see Container queries) — a card should look right whether it's alone in a hero or squeezed into a three-column grid, without knowing which.
- Never hardcode a breakpoint to match a specific device model (`@media (max-width: 375px) /* iPhone SE */`). Pick round numbers based on where the content breaks, not a device catalog.

---

## Designing it in from the start

### Layout toolbox: pick the right tool

| Need                                                                              | Use               |
| --------------------------------------------------------------------------------- | ----------------- |
| One-dimensional row/column of items, alignment, spacing                           | Flexbox           |
| Two-dimensional layout, page/section structure, precise placement                 | CSS Grid          |
| A reusable component that must adapt to _its container's_ width, not the viewport | Container queries |
| A grid where nested items should align to the parent grid's tracks                | `subgrid`         |
| Global layout shifts (nav collapsing, columns stacking) tied to _window_ size     | Media queries     |

Grid and Flexbox aren't competitors — most real layouts nest both: Grid for the page skeleton, Flexbox for the row of buttons inside a card.

### Container queries: the component-level answer

Media queries only know the viewport. If a card can be dropped into a narrow sidebar or a wide hero, it needs to respond to its own box. Support is solid across all major evergreen browsers — use it as a default tool, not an experimental one.

```css
.card-slot {
  container-type: inline-size;
  container-name: card;
}

@container card (min-width: 400px) {
  .card {
    display: flex;
    gap: var(--space-4);
  }
}
```

- Use `container-type: inline-size` (width only) unless block-size is specifically needed — it's cheaper.
- Name containers in anything non-trivial.
- Container query units (`cqw`, `cqi`) scale fluidly with the container and often replace a chain of size breakpoints.

### Breakpoint reference (starting point, not a mandate)

| Class                      | Width       |
| -------------------------- | ----------- |
| Small phone                | 375px       |
| Large phone / small tablet | 480–600px   |
| Tablet                     | 768px       |
| Small laptop               | 1024px      |
| Desktop                    | 1280–1440px |
| Wide / ultrawide           | 1920px+     |

### Fluid sizing over breakpoint-hopping

```css
font-size: clamp(1.5rem, 1rem + 2vw, 2.5rem);
padding-inline: clamp(1rem, 4vw, 3rem);
```

`clamp(min, preferred, max)` scales continuously between a floor and ceiling instead of snapping at fixed points. Use it for hero type, section padding, and anything else that should feel proportional at every width.

### Viewport units: use the dynamic ones on mobile

Plain `vh` is based on the _initial_ viewport and doesn't update as a mobile browser's address bar shows/hides.

| Unit  | Meaning                                                                            |
| ----- | ---------------------------------------------------------------------------------- |
| `svh` | Small viewport — chrome fully expanded (safest floor for "always visible" content) |
| `lvh` | Large viewport — chrome fully collapsed                                            |
| `dvh` | Dynamic — tracks the current state live                                            |

```css
.hero {
  min-height: 100vh; /* fallback */
  min-height: 100svh; /* modern browsers override this */
}
```

Account for notches/home-bars on anything pinned to a screen edge: `padding-bottom: max(1rem, env(safe-area-inset-bottom));`

### Responsive images and media

- Always set intrinsic `width`/`height` or `aspect-ratio` so the browser reserves space before the asset loads.
- Use `srcset`/`sizes` (or `<picture>` for art-direction) so phones don't download a desktop-sized image.
- `object-fit: cover` with a fixed `aspect-ratio` container keeps images from distorting as their box reflows.

### Input and touch adaptation

```css
@media (pointer: coarse) {
  .btn {
    min-height: 44px;
  }
}
@media (hover: none) {
  .tooltip-trigger {
    /* show on tap instead */
  }
}
```

- Never gate essential functionality behind `:hover` alone — always provide a tap/focus equivalent.
- Touch targets: 44×44px is the practical standard for primary controls; 24×24px is the WCAG legal minimum (with spacing exceptions), not a target to design toward.
- Keep form input `font-size` at 16px+ on mobile — anything smaller triggers unwanted zoom-on-focus in Safari.
- Never disable pinch-zoom (`user-scalable=no` / `maximum-scale=1`) — it's a WCAG violation.

### Typography that holds up at every width

- Constrain line length to 50–75 characters (`max-width: 65ch`) regardless of viewport.
- Scale with `clamp()` rather than a different fixed size per breakpoint.
- Re-check letter-spacing/line-height at the _small_ end of the range — a headline fine at 48px can feel cramped once `clamp()` shrinks it to 28px.

### Performance: what makes it feel smooth, not just fit

- Animate `transform`/`opacity`, not `width`/`height`/`top`/`left` — the latter force layout recalculation on every frame.
- Use `contain: layout` or `content-visibility: auto` so one component's change doesn't force the whole page to re-measure.
- Prefer a media query, container query, or `clamp()` over a JS `resize` listener with manually-toggled classes.
- Respect `@media (prefers-reduced-motion: reduce)` — strip transform-based motion, keep opacity crossfades.
