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

| Duration   | Use Case                                                     |
| ---------- | ------------------------------------------------------------ |
| 50–100 ms  | Instant feedback (button press, toggle, hover)               |
| 150 ms     | State confirmation (checkbox check, switch toggle)           |
| 200–300 ms | Entering UI (modals, sheets, dropdowns)                      |
| 300–500 ms | Cross-screen transitions (page changes, major state changes) |

**Never animate to teach, decorate, or signal "premium"** — animate when the user is moving through space, time, or state.

---

# Easing Functions

## Material 3 Standard (Recommended)

```css
/* Standard easing for most transitions */
transition-timing-function: cubic-bezier(0.2, 0, 0, 1);

/* Decelerate: entering elements */
transition-timing-function: cubic-bezier(0, 0, 0, 1);

/* Accelerate: exiting elements */
transition-timing-function: cubic-bezier(0.3, 0, 1, 1);
```

## Common Easings

```css
/* Ease out: smooth deceleration */
transition-timing-function: ease-out;

/* Ease in out: smooth acceleration and deceleration */
transition-timing-function: ease-in-out;

/* Linear: constant speed (rarely appropriate for UI) */
transition-timing-function: linear;
```

---

# CSS Transitions

## Button Hover

```css
.button {
  transition: all 150ms cubic-bezier(0.2, 0, 0, 1);
}

.button:hover {
  background: var(--color-accent);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--color-shadow);
}

.button:active {
  transform: translateY(0);
  box-shadow: none;
}
```

## Card Hover

```css
.card {
  transition:
    border-color 200ms cubic-bezier(0.2, 0, 0, 1),
    background-color 200ms cubic-bezier(0.2, 0, 0, 1);
}

.card:hover {
  border-color: var(--color-accent);
  background: var(--color-bg-elevated);
}
```

## Focus Ring

```css
.input {
  transition:
    border-color 150ms cubic-bezier(0.2, 0, 0, 1),
    box-shadow 150ms cubic-bezier(0.2, 0, 0, 1);
}

.input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(var(--color-accent-rgb), 0.2);
}
```

---

# Tailwind Transition Utilities

```html
<!-- Basic hover transition -->
<button class="transition-colors duration-150 hover:bg-(--color-accent)">Hover me</button>

<!-- Transform on hover -->
<div class="transition-all duration-200 hover:scale-[1.02] hover:shadow-lg">
  Scales up slightly on hover
</div>

<!-- Opacity transition -->
<div class="transition-opacity duration-150 hover:opacity-80">Fades slightly on hover</div>

<!-- Combined transitions -->
<div class="transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md">
  Lifts on hover
</div>
```

---

# CSS Keyframe Animations

## Fade In

```css
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.animate-fade-in {
  animation: fadeIn 200ms cubic-bezier(0.2, 0, 0, 1) forwards;
}
```

## Slide Up

```css
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-slide-up {
  animation: slideUp 300ms cubic-bezier(0.2, 0, 0, 1) forwards;
}
```

## Scale In

```css
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-scale-in {
  animation: scaleIn 200ms cubic-bezier(0.2, 0, 0, 1) forwards;
}
```

## Spin (Loading)

```css
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
```

---

# Micro-Interactions

## Button Press

```css
.button:active {
  transform: scale(0.97);
  transition-duration: 50ms;
}
```

## Number Count Up

```css
@property --num {
  syntax: '<integer>';
  initial-value: 0;
  inherits: false;
}

.counter {
  transition: --num 500ms cubic-bezier(0.2, 0, 0, 1);
  counter-reset: num var(--num);
}

.counter::after {
  content: counter(num);
}
```

## Toggle Switch

```css
.toggle {
  transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.toggle::after {
  transition: transform 150ms cubic-bezier(0.2, 0, 0, 1);
}

.toggle.active::after {
  transform: translateX(20px);
}
```

## Skeleton Loading

```css
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-bg-card) 25%,
    var(--color-bg-elevated) 50%,
    var(--color-bg-card) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

---

# Reduced Motion

Always respect the user's motion preferences:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

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
