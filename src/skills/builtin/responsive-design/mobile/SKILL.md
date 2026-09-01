---
name: mobile
description: Design or review a mobile screen (~390px) — thumb ergonomics, touch targets, one-hand use, and mobile-native patterns
tags: mobile, touch, thumb-zone, viewport, safe-area, hit-targets, sheets, navigation, accessibility, performance
modes: design
---

# Mobile Design

A phone screen is a small, touch-only, one-hand, attention-fragmented, interruptible device. Every rule below exists because the desktop assumption it replaces fails on a phone. The design should feel native to the hand, not like a shrunken web page.

## The one-hand reality

The phone is held in one hand and driven by a thumb. The thumb pivots from the bottom-right (most right-handed users) and simply cannot reach the top of a large screen without a grip change.

- Put **primary actions in the bottom third** — bottom nav bars, sticky bottom CTAs, bottom sheets. The top of the screen is for context (title, status), not for the button the user needs most.
- Place **destructive or cancel actions away from the thumb's resting arc** (top-left, or behind confirmation) — accidental activation is worse than extra reach.
- **Thumb-zone check on every screen:** can the core task be completed without changing grip? If not, move the controls, not the user's expectations.

## Touch targets (hard rules)

- **44×44px minimum** for every tappable element — measure the target, not the icon inside it. An 18px icon with generous padding is fine; an 18px button is not.
- **8px minimum spacing between adjacent targets** — mis-taps cluster on tightly packed icon rows, toolbars, and list-item trailing actions.
- Whole **list rows are the tap target**, not just the text inside them. Add a visible affordance (chevron, press state) so the extent of the target is discoverable.
- Gesture-driven UI (swipe actions, drag handles) is an **addition, never a replacement** — always provide a tapped alternative for the same action.
- Never gate essential functionality behind hover. There is no hover. Tooltips become tappable popovers or inline reveal.

## Layout: one column, one job

- **Single-column stack** is the default. Side-by-side columns only for genuinely paired content (e.g. a label + toggle), never for parallel page sections.
- Vertical scrolling is the natural gesture — **do not fight it** with horizontal scroll, carousels, or pinned panes unless the content is inherently horizontal (media galleries, chip filters).
- Content decides height: **never clip a screen to fit** "one viewport". `min-height: 100dvh`, not fixed `height`. Use `100dvh`/`100svh` (with a `100vh` fallback line first) for full-screen sections so browser chrome doesn't hide the bottom CTA.
- Respect the **safe areas** on edge-pinned elements: `padding-bottom: max(12px, env(safe-area-inset-bottom))` on bottom bars; equivalent insets on notch/home-indicator edges.
- Sticky elements are allowed to eat viewport height (header + bottom bar can consume 25%+ of a small phone) — budget for it, and never let two sticky regions sandwich a scroll area so small nothing is readable.

## Mobile-native patterns (use them, don't reinvent)

- **Bottom tab bar** (3–5 items, icons + short labels) for top-level navigation. Hamburger-only navigation hides the app's structure.
- **Bottom sheets** for in-context detail, pickers, and confirmations — they keep the originating screen visible and stay in thumb reach.
- **Full-screen takeover** for focused tasks (compose, checkout) with a clear close/complete affordance at the top.
- **Pull-to-refresh** where the user expects live data; a visible loading state that doesn't jump the layout.
- **FAB** only when there is exactly one dominant action on the screen — two FABs is zero FABs.
- Skeleton screens for loading; empty states with a headline, one-line explanation, and a bottom-anchored CTA.

## Typography and content on a small canvas

- Body text **16px minimum** — this is also the threshold below which iOS zooms on input focus, so form fields must be 16px too.
- Hierarchy must survive a glance: one display size, one heading size, body, caption. Letter-spacing: ALL CAPS gets 0.06–0.1em; keep body at 0.
- Line length is naturally fine at full width on 390px (~20ch is too few — use ~85–90% width or 24px side padding so body copy doesn't become choppy).
- **Prioritize ruthlessly.** A mobile screen shows the 20% of content that does the job. Progressive disclosure (expandable sections, sheets) carries the rest. If everything is important, the design has failed, not the screen size.
- No text smaller than 11px, ever. Meta information earns its place or gets cut.

## Forms on mobile

- One question per row; full-width inputs; labels always visible above the field (placeholder-as-label hides context the moment typing starts).
- Correct `type`/`inputmode` for every field (`type="email"`, `inputmode="numeric"`) so the right keyboard appears.
- Primary submit action **sticky at the bottom**, in thumb reach — not a button floating after a long scroll.
- Validation messages inline, adjacent to the field, preserving what the user typed.
- Autocomplete attributes (`autocomplete="email"`, `autocomplete="cc-number"`) — on mobile this is a feature, not a nicety.

## Performance and motion (where phones actually struggle)

- Animate only `transform` and `opacity`; never `width`/`height`/`top`/`left` — mid-range phones drop frames on layout-triggering animation.
- Every image gets intrinsic `width`/`height` or `aspect-ratio` — layout shift is far more jarring on a small screen.
- Durations: 50–100ms press feedback, 200–300ms sheets/modals. Press states (`scale(0.97)` or opacity) on every touchable element — touch needs acknowledgment mouse UI never does.
- Always ship `@media (prefers-reduced-motion: reduce)` — opacity crossfades only.

## Anti-patterns (fix before shipping)

1. **Shrunken desktop layout** — multi-column grids, tiny nav links, sidebars crammed into 390px.
2. **Sub-44px targets**, especially packed icon rows and "×" close buttons.
3. **Primary CTA at the very top** of a long form or page.
4. **Hover-dependent menus or tooltips** with no tap equivalent.
5. **Fixed-height hero/modals** that clip content or hide behind browser chrome (`100vh` without a `dvh` strategy).
6. **Placeholder-only labels** and sub-16px inputs.
7. **Horizontal scroll** appearing by accident — check for overflowing tables, code blocks, and long unbreakable strings.
8. **Disabling pinch-zoom** (`user-scalable=no`) — an accessibility violation.
