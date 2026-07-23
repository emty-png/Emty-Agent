---
name: layout-patterns
description: Layout patterns including CSS Grid, Flexbox, responsive layouts, spacing rhythm, and Tailwind v4 utilities for design projects.
tags: layout, grid, flexbox, responsive, spacing, tailwind, design
when_to_use: Use in design mode when building layouts, grids, or responsive designs
modes: design
---

Layout patterns for design projects. Covers CSS Grid, Flexbox, responsive layouts, spacing rhythm, and Tailwind v4 utilities.

---

# Tailwind v4 Syntax

Tailwind CSS is available in the design canvas via CDN. Use the parenthetical theme variable syntax for custom properties:

```
bg-(--color-surface)     → background: var(--color-surface)
text-(--color-accent)    → color: var(--color-accent)
border-(--color-border)  → border-color: var(--color-border)
```

Do NOT use the bracket syntax `bg-[var(--color-surface)]` — parenthetical is preferred.

---

# Spacing Rhythm

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

---

# Flexbox Patterns

## Centering

```html
<!-- Perfect centering -->
<div class="flex items-center justify-center">Centered content</div>

<!-- Horizontal centering with vertical alignment -->
<div class="flex items-center gap-4">
  <span class="shrink-0">Icon</span>
  <span class="flex-1">Content</span>
</div>
```

## Navigation Bar

```html
<nav class="flex items-center justify-between h-16 px-6">
  <div class="flex items-center gap-2">
    <!-- Logo -->
  </div>
  <div class="flex items-center gap-6">
    <!-- Nav links -->
  </div>
</nav>
```

## Card Row

```html
<div class="flex gap-4 overflow-x-auto">
  <div class="shrink-0 w-64">Card 1</div>
  <div class="shrink-0 w-64">Card 2</div>
  <div class="shrink-0 w-64">Card 3</div>
</div>
```

---

# CSS Grid Patterns

## Basic Grid

```html
<div class="grid grid-cols-3 gap-6">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

## Responsive Grid (Auto-fill)

```html
<div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
  <div>Auto-sized card</div>
  <div>Auto-sized card</div>
  <div>Auto-sized card</div>
</div>
```

## Dashboard Layout

```html
<div class="grid grid-cols-[240px_1fr] min-h-screen">
  <!-- Sidebar -->
  <aside class="border-r border-(--color-border) p-4">Navigation</aside>
  <!-- Main content -->
  <main class="p-8">Content</main>
</div>
```

## Holy Grail Layout

```html
<div class="grid grid-rows-[auto_1fr_auto] min-h-screen">
  <header class="h-16">Header</header>
  <main class="p-8">Content</main>
  <footer class="h-12">Footer</footer>
</div>
```

## Spanning Columns

```html
<div class="grid grid-cols-4 gap-4">
  <div class="col-span-2">Wide item</div>
  <div>Normal</div>
  <div>Normal</div>
  <div class="col-span-4">Full width</div>
</div>
```

---

# Responsive Layouts

## Container with Max Width

```html
<div class="mx-auto max-w-7xl px-6 lg:px-8">
  <div class="mx-auto max-w-2xl lg:text-center">
    <!-- Centered content with max width -->
  </div>
</div>
```

## Responsive Sidebar

```html
<div class="flex min-h-screen">
  <!-- Sidebar: hidden on mobile, visible on desktop -->
  <aside class="hidden lg:block lg:w-64 lg:border-r lg:border-(--color-border)">Navigation</aside>
  <!-- Main content -->
  <main class="flex-1 p-6 lg:p-8">Content</main>
</div>
```

## Container Queries (Modern)

```css
.card-container {
  container-type: inline-size;
}

@container (min-width: 400px) {
  .card {
    display: grid;
    grid-template-columns: 1fr 2fr;
  }
}
```

---

# Layout Utilities

## Aspect Ratios

```html
<!-- 16:9 aspect ratio -->
<div class="aspect-video bg-(--color-bg-card)">Video content</div>

<!-- 1:1 square -->
<div class="aspect-square bg-(--color-bg-card)">Square content</div>
```

## Overflow Control

```html
<!-- Truncate text -->
<p class="truncate">Long text that gets truncated with ellipsis</p>

<!-- Scrollable container -->
<div class="overflow-auto max-h-96">Scrollable content</div>

<!-- Hide scrollbar but keep scroll -->
<div class="overflow-auto scrollbar-none">Scrollable without visible scrollbar</div>
```

## Z-Index Stack

```html
<div class="relative">
  <div class="relative z-10">Above</div>
  <div class="absolute inset-0 z-0">Behind</div>
</div>
```

---

# Spacing Patterns

## Page Sections

```html
<section class="py-24 px-6">
  <div class="mx-auto max-w-6xl">
    <div class="space-y-12">
      <!-- 48px between sections -->
    </div>
  </div>
</section>
```

## Card Internal Spacing

```html
<div class="p-6 space-y-4">
  <!-- 16px between card elements -->
  <h3 class="text-lg font-semibold">Title</h3>
  <p class="text-sm text-(--color-text-secondary)">Description</p>
  <div class="flex gap-2 pt-2">
    <!-- 8px between buttons, with top padding -->
    <button>Action 1</button>
    <button>Action 2</button>
  </div>
</div>
```

## Form Spacing

```html
<form class="space-y-6">
  <!-- 24px between form groups -->
  <div class="space-y-2">
    <!-- 8px between label and input -->
    <label class="text-sm font-medium">Email</label>
    <input class="w-full px-3 py-2 rounded-lg border border-(--color-border)" />
  </div>
  <div class="space-y-2">
    <label class="text-sm font-medium">Password</label>
    <input class="w-full px-3 py-2 rounded-lg border border-(--color-border)" />
  </div>
</form>
```

---

# Checklist

- [ ] Spacing is tighter within groups (8–12px), wider between groups (32–48px)
- [ ] Layout uses CSS Grid or Flexbox (not floats or margins for layout)
- [ ] Content has appropriate max-width (65ch for text, 1200px for pages)
- [ ] Responsive breakpoints are considered (mobile-first or desktop-first)
- [ ] Container queries used for component-level responsiveness where appropriate
