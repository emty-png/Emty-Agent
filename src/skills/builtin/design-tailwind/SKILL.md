---
name: design-tailwind
description: Tailwind v4 utility class reference for design mode artifacts. Includes spacing rhythm, typography patterns, shadow tiers, and animation guidance.
tags: tailwind, css, design, utility, layout
when_to_use: Use in design mode when building UI with Tailwind classes
modes: design
---

Tailwind CSS is available in the design canvas via CDN. Use Tailwind utility classes for layout, spacing, typography, colors, and effects. Write minimal custom CSS — prefer utilities.

## Tailwind v4 Syntax

Use the parenthetical theme variable syntax for custom properties:

```
bg-(--color-surface)     → background: var(--color-surface)
text-(--color-accent)    → color: var(--color-accent)
border-(--color-border)  → border-color: var(--color-border)
```

Do NOT use the bracket syntax `bg-[var(--color-surface)]` — parenthetical is preferred.

## Layout

```html
<!-- Flex -->
<div class="flex items-center gap-4">
  <!-- Grid -->
  <div class="grid grid-cols-3 gap-6">
    <!-- Centering -->
    <div class="flex items-center justify-center">
      <!-- Container -->
      <div class="mx-auto max-w-2xl px-6"></div>
    </div>
  </div>
</div>
```

## Spacing Rhythm

Use the consistent scale: `0.5`=2px, `1`=4px, `1.5`=6px, `2`=8px, `3`=12px, `4`=16px, `5`=20px, `6`=24px, `8`=32px, `10`=40px, `12`=48px.

**Variable vertical rhythm** — use tighter spacing within groups, wider spacing between groups:

- 8–12px (`gap-2` to `gap-3`) within a logical group (form fields, list items)
- 32–48px (`gap-8` to `gap-12`) between major sections

Uniform spacing everywhere reads as nothing being grouped.

```html
<!-- Within a group: tight -->
<div class="space-y-2">
  <!-- 8px between siblings in a card -->

  <!-- Between sections: generous -->
  <div class="space-y-12">
    <!-- 48px between major page sections -->

    <!-- In flex/grid containers -->
    <div class="flex gap-3">
      <!-- 12px between related items -->
      <div class="grid grid-cols-3 gap-8"><!-- 32px between grid items --></div>
    </div>
  </div>
</div>
```

## Typography

```html
<h1 class="text-4xl font-bold tracking-tight">Title</h1>
<h2 class="text-2xl font-semibold">Subtitle</h2>
<p class="text-base leading-relaxed text-gray-400">Body text</p>
<span class="text-sm font-medium text-gray-500">Small label</span>
<code class="font-mono text-sm">code here</code>
```

**Tracking classes for craft quality:**

```html
<!-- ALL CAPS must have positive tracking -->
<span class="text-xs font-semibold uppercase tracking-widest">Label</span>

<!-- Display text needs negative tracking -->
<h1 class="text-5xl font-bold tracking-tighter">Headline</h1>

<!-- Body text: default tracking -->
<p class="text-base leading-relaxed">Body copy at natural tracking.</p>
```

**Three-weight system:**

- `font-normal` (400) — body copy
- `font-medium` (500) — UI text, labels, navigation
- `font-semibold` (600) — headlines, buttons

Avoid `font-bold` (700+) unless truly needed. Weight should jump, not step.

## Colors

Use semantic color variables or Tailwind defaults:

```html
<!-- Semantic (from design-themes skill) -->
<div class="bg-(--color-bg) text-(--color-text)">
  <!-- Tailwind defaults -->
  <div class="bg-white/10 backdrop-blur-sm">
    <div class="text-gray-300 hover:text-white"></div>
  </div>
</div>
```

## Borders & Radius

```html
<div class="border border-white/10 rounded-lg">
  <div class="rounded-xl border border-white/5 bg-white/5">
    <div class="rounded-full p-2"><!-- pill shape --></div>
  </div>
</div>
```

**On dark surfaces:** prefer semi-transparent white borders over solid dark borders:

```html
<!-- Good: semi-transparent white -->
<div class="border border-white/[0.08]">
  <!-- Avoid: solid dark borders on dark bg -->
  <div class="border border-gray-800"></div>
</div>
```

## Shadows & Elevation

Use shadows sparingly and match the elevation level to the UI context:

```html
<!-- Level 1: subtle (toolbar buttons, micro-elevation) -->
<div class="shadow-sm">
  <!-- Level 2: surface (cards, inputs) — prefer border over shadow on dark -->
  <div class="border border-white/[0.08] bg-white/5">
    <!-- Level 3: raised (dropdowns, popovers) -->
    <div class="shadow-lg shadow-black/20">
      <!-- Level 4: dialog (modals, overlays) -->
      <div class="shadow-2xl shadow-black/40">
        <!-- Focus ring -->
        <div class="ring-2 ring-(--color-accent)/30 ring-offset-2 ring-offset-(--color-bg)"></div>
      </div>
    </div>
  </div>
</div>
```

## Transitions & Animation

```html
<!-- State confirmation (150ms — default) -->
<button class="transition-colors duration-150 hover:bg-white/10">
  <!-- Entering UI (200-300ms) -->
  <div class="transition-all duration-200 ease-out">
    <!-- Hover micro-interaction -->
    <button
      class="transition-transform duration-100 hover:scale-[1.02] active:scale-[0.98]"
    ></button>
  </div>
</button>
```

**Duration thresholds:**

- 50–100ms: instant feedback (button press, toggle)
- 150ms: default state-confirmation
- 200–300ms: entering UI (modals, sheets, dropdowns)
- 300–500ms: cross-screen transitions

**Modern easing:**

```css
/* Material 3 standard — front-loaded, settles instantly */
transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
```

Always respect reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## CSS Power Moves

When Tailwind utilities aren't enough, use the `css` field for:

```css
/* Fluid typography */
h1 {
  font-size: clamp(2rem, 5vw, 4rem);
}

/* Text wrapping */
p {
  text-wrap: pretty;
}

/* Container queries */
@container (min-width: 640px) {
  .card {
    grid-template-columns: 1fr 1fr;
  }
}

/* Derived colors */
.badge {
  background: color-mix(in oklab, var(--color-accent), transparent 90%);
}

/* Modern easing */
.animate-in {
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
```

Use Tailwind for everything else.
