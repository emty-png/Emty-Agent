---
name: animation-motion
description: Animation and motion design including CSS transitions, keyframes, easing functions, micro-interactions, and reduced motion preferences.
tags: animation, motion, transitions, keyframes, easing, design
when_to_use: Use in design mode when adding animations, transitions, or micro-interactions to a design
modes: design
---

Animation and motion design for design projects. Covers CSS transitions, keyframes, easing functions, micro-interactions, and accessibility considerations.

---

# Timing Guidelines

- 50–100 ms: Instant feedback (button press, toggle, hover)
- 150 ms: State confirmation (checkbox check, switch toggle)
- 200–300 ms: Entering UI (modals, sheets, dropdowns)
- 300–500 ms: Cross-screen transitions (page changes, major state changes)

**Never animate to teach, decorate, or signal "premium"** — animate when the user is moving through space, time, or state.

---

# Easing Functions

## Material 3 Standard (Recommended)

Use `cubic-bezier(0.2, 0, 0, 1)` as the standard easing for most transitions.
Use `cubic-bezier(0, 0, 0, 1)` for decelerate (entering elements).
Use `cubic-bezier(0.3, 0, 1, 1)` for accelerate (exiting elements).

## Common Easings

- `ease-out`: Smooth deceleration
- `ease-in-out`: Smooth acceleration and deceleration
- `linear`: Constant speed (rarely appropriate for UI)

---

# CSS Transitions

## Button Hover

Use `transition: all 150ms cubic-bezier(0.2, 0, 0, 1)` on interactive elements.
On hover: apply `background`, `transform: translateY(-1px)`, and `box-shadow`.
On active: reset `transform: translateY(0)` and `box-shadow: none`.

## Card Hover

Use `transition: border-color 200ms, background-color 200ms` with Material 3 easing.
On hover: change `border-color` to accent and `background` to elevated.

## Focus Ring

Use `transition: border-color 150ms, box-shadow 150ms` with Material 3 easing.
On focus: set `outline: none`, `border-color` to accent, and `box-shadow: 0 0 0 3px rgba(accent, 0.2)`.

---

# Tailwind Transition Utilities

- `transition-colors duration-150 hover:bg-(--color-accent)`: Basic hover transition
- `transition-all duration-200 hover:scale-[1.02] hover:shadow-lg`: Transform on hover
- `transition-opacity duration-150 hover:opacity-80`: Opacity transition
- `transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md`: Combined transitions

---

# CSS Keyframe Animations

## Fade In

Define `@keyframes fadeIn` from `opacity: 0` to `opacity: 1`. Apply with `animation: fadeIn 200ms cubic-bezier(0.2, 0, 0, 1) forwards`.

## Slide Up

Define `@keyframes slideUp` from `opacity: 0; transform: translateY(8px)` to `opacity: 1; transform: translateY(0)`. Apply with `animation: slideUp 300ms cubic-bezier(0.2, 0, 0, 1) forwards`.

## Scale In

Define `@keyframes scaleIn` from `opacity: 0; transform: scale(0.95)` to `opacity: 1; transform: scale(1)`. Apply with `animation: scaleIn 200ms cubic-bezier(0.2, 0, 0, 1) forwards`.

## Spin (Loading)

Define `@keyframes spin` from `transform: rotate(0deg)` to `transform: rotate(360deg)`. Apply with `animation: spin 1s linear infinite`.

---

# Micro-Interactions

## Button Press

On active: `transform: scale(0.97); transition-duration: 50ms`.

## Number Count Up

Use `@property --num` with `syntax: '<integer>'`. Set `transition: --num 500ms cubic-bezier(0.2, 0, 0, 1)` and `counter-reset: num var(--num)`. Display with `counter(num)` via `::after`.

## Toggle Switch

Use `transition: background-color 150ms` on the toggle and `transition: transform 150ms` on `::after`. On active, set `::after { transform: translateX(20px) }`.

## Skeleton Loading

Define `@keyframes shimmer` animating `background-position` from `-200% 0` to `200% 0`. Apply a `linear-gradient` background with `background-size: 200% 100%` and `animation: shimmer 1.5s ease-in-out infinite`.

---

# Reduced Motion

Always respect the user's motion preferences. In a `@media (prefers-reduced-motion: reduce)` block, set `animation-duration: 0.01ms !important`, `animation-iteration-count: 1 !important`, `transition-duration: 0.01ms !important`, and `scroll-behavior: auto !important` on all elements.

**Rules:**

- Strip transform-based motion (scale, translate, rotate)
- Keep opacity crossfades (they're generally safe)
- Never remove essential state-change feedback entirely
- If in doubt, make motion optional

---

# Checklist

- [ ] Transition durations are appropriate for the interaction type
- [ ] Easing functions use Material 3 standard or appropriate alternatives
- [ ] Animations respect `prefers-reduced-motion`
- [ ] No animations loop infinitely (except loading indicators)
- [ ] No animations to teach or decorate — only for spatial/state transitions
- [ ] Micro-interactions are subtle (2–4px movement, not 20px)
