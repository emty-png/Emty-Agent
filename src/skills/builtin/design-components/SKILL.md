---
name: design-components
description: UI Component Library — reusable button, card, modal, form, navigation, table, and feedback patterns with Tailwind v4 classes for design canvas artifacts. Includes state coverage and interaction patterns.
tags: components, ui, buttons, cards, modals, forms, navigation, tables
when_to_use: Use in design mode when building UI components
modes: design
---

Reusable UI component patterns for the design canvas. All patterns use Tailwind v4 utility classes. Pick the patterns that match the design intent and adapt as needed.

Every interactive component should show at minimum the **populated** state. When building dashboards or data-heavy UIs, also include loading, empty, and error states.

## Buttons

```html
<!-- Primary -->
<button
  class="px-4 py-2 bg-(--color-accent) text-white font-medium rounded-lg transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
>
  Save Changes
</button>

<!-- Secondary / Ghost -->
<button
  class="px-4 py-2 bg-transparent text-(--color-text-secondary) border border-white/10 rounded-lg transition-all duration-150 hover:bg-white/5 hover:text-white"
>
  Cancel
</button>

<!-- Danger -->
<button
  class="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg transition-all duration-150 hover:bg-red-500/20"
>
  Delete
</button>

<!-- Icon button (min 44px touch target) -->
<button
  class="flex items-center justify-center w-10 h-10 rounded-lg text-(--color-text-secondary) hover:bg-white/5 transition-colors duration-150"
>
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ...
  </svg>
</button>

<!-- Small -->
<button class="px-3 py-1.5 text-sm rounded-md transition-colors duration-150">Apply</button>

<!-- Loading state -->
<button
  class="px-4 py-2 bg-(--color-accent) text-white font-medium rounded-lg opacity-75 cursor-not-allowed"
  disabled
>
  <svg class="animate-spin -ml-1 mr-2 h-4 w-4" viewBox="0 0 24 24">
    <circle
      class="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width="4"
      fill="none"
    />
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
  Saving...
</button>
```

## Cards

```html
<!-- Basic card -->
<div class="p-6 rounded-xl border border-white/10 bg-white/5">
  <h3 class="text-lg font-semibold mb-2">Card Title</h3>
  <p class="text-sm text-(--color-text-secondary)">Description text here.</p>
</div>

<!-- Interactive card -->
<div
  class="group p-6 rounded-xl border border-white/10 bg-white/5 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08] cursor-pointer"
>
  <h3 class="text-lg font-semibold mb-2 group-hover:text-white">Clickable Card</h3>
  <p class="text-sm text-(--color-text-secondary)">
    Hover effect with border and background change.
  </p>
</div>

<!-- Stat card -->
<div class="p-5 rounded-xl bg-white/5 border border-white/10">
  <span class="text-xs text-(--color-text-secondary) uppercase tracking-widest">Revenue</span>
  <div class="text-3xl font-semibold mt-1 tabular-nums">$48,200</div>
  <span class="text-sm text-green-400 mt-2">+12.5%</span>
</div>
```

## Modals / Dialogs

```html
<!-- Backdrop -->
<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
  <!-- Dialog -->
  <div class="w-full max-w-md p-6 rounded-2xl border border-white/10 bg-[#1a1a2e] shadow-2xl">
    <h2 class="text-xl font-semibold mb-4">Dialog Title</h2>
    <p class="text-sm text-(--color-text-secondary) mb-6">Dialog content goes here.</p>
    <div class="flex justify-end gap-3">
      <button
        class="px-4 py-2 text-sm text-(--color-text-secondary) hover:text-white transition-colors duration-150"
      >
        Cancel
      </button>
      <button
        class="px-4 py-2 text-sm bg-(--color-accent) text-white font-medium rounded-lg transition-all duration-150 hover:opacity-90"
      >
        Confirm
      </button>
    </div>
  </div>
</div>
```

## Forms

```html
<!-- Input with label and hint -->
<div class="space-y-1.5">
  <label for="email" class="text-sm font-medium text-gray-300">Email</label>
  <input
    id="email"
    type="email"
    class="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-(--color-accent)/50 transition-shadow duration-150"
    placeholder="you@example.com"
    aria-describedby="email-hint"
  />
  <span id="email-hint" class="text-xs text-(--color-text-secondary)">Used for receipts only.</span>
</div>

<!-- Input with error state -->
<div class="space-y-1.5">
  <label for="password" class="text-sm font-medium text-gray-300">Password</label>
  <input
    id="password"
    type="password"
    class="w-full px-3 py-2 rounded-lg border border-red-500/50 bg-white/5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
    aria-invalid="true"
    aria-describedby="password-error"
  />
  <span id="password-error" class="text-xs text-red-400" role="alert">
    Password must be at least 8 characters.
  </span>
</div>

<!-- Textarea -->
<textarea
  rows="4"
  class="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-(--color-accent)/50"
  placeholder="Write something..."
></textarea>

<!-- Select -->
<select
  class="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/50"
>
  <option>Option 1</option>
  <option>Option 2</option>
</select>

<!-- Toggle -->
<button
  role="switch"
  aria-checked="true"
  class="relative w-10 h-5 rounded-full bg-(--color-accent) transition-colors duration-150"
>
  <span
    class="absolute top-0.5 left-[22px] w-4 h-4 rounded-full bg-white transition-transform duration-150"
  ></span>
</button>

<!-- Checkbox -->
<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
  <input
    type="checkbox"
    class="w-4 h-4 rounded border-white/20 bg-white/5 accent-(--color-accent)"
  />
  Accept terms
</label>
```

## Navigation

```html
<!-- Tabs -->
<div class="flex border-b border-white/10" role="tablist">
  <button
    role="tab"
    aria-selected="true"
    class="px-4 py-2 text-sm font-medium text-white border-b-2 border-(--color-accent)"
  >
    Active
  </button>
  <button
    role="tab"
    aria-selected="false"
    class="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-300 border-b-2 border-transparent"
  >
    Inactive
  </button>
</div>

<!-- Breadcrumb -->
<nav aria-label="Breadcrumb" class="flex items-center gap-2 text-sm text-gray-500">
  <a href="#" class="hover:text-white transition-colors duration-150">Home</a>
  <span aria-hidden="true">/</span>
  <a href="#" class="hover:text-white transition-colors duration-150">Projects</a>
  <span aria-hidden="true">/</span>
  <span aria-current="page" class="text-white">Current Page</span>
</nav>

<!-- Sidebar nav -->
<nav class="space-y-1">
  <a
    class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-white/5 hover:text-white transition-colors duration-150"
  >
    Dashboard
  </a>
  <a
    class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm bg-white/10 text-white font-medium"
  >
    Active Item
  </a>
</nav>
```

## Data Tables

```html
<div class="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-white/10">
        <th
          class="px-4 py-3 text-left text-xs font-medium text-(--color-text-secondary) uppercase tracking-widest"
        >
          Name
        </th>
        <th
          class="px-4 py-3 text-left text-xs font-medium text-(--color-text-secondary) uppercase tracking-widest"
        >
          Status
        </th>
        <th
          class="px-4 py-3 text-right text-xs font-medium text-(--color-text-secondary) uppercase tracking-widest tabular-nums"
        >
          Amount
        </th>
      </tr>
    </thead>
    <tbody class="divide-y divide-white/5">
      <tr class="hover:bg-white/[0.02] transition-colors duration-100">
        <td class="px-4 py-3 font-medium">Invoice #1042</td>
        <td class="px-4 py-3">
          <span
            class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400"
          >
            Paid
          </span>
        </td>
        <td class="px-4 py-3 text-right tabular-nums">$1,200.00</td>
      </tr>
      <tr class="hover:bg-white/[0.02] transition-colors duration-100">
        <td class="px-4 py-3 font-medium">Invoice #1043</td>
        <td class="px-4 py-3">
          <span
            class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400"
          >
            Pending
          </span>
        </td>
        <td class="px-4 py-3 text-right tabular-nums">$850.00</td>
      </tr>
    </tbody>
  </table>
</div>
```

## Search / Filter Bar

```html
<div class="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5">
  <svg
    class="w-4 h-4 text-gray-500"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
  <input
    type="text"
    placeholder="Search..."
    class="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
  />
  <button
    class="px-3 py-1 text-xs text-(--color-text-secondary) border border-white/10 rounded-md hover:bg-white/5 transition-colors duration-150"
  >
    Filter
  </button>
</div>
```

## Toast / Notification

```html
<div
  class="flex items-start gap-3 p-4 rounded-xl border border-white/10 bg-[#1a1a2e] shadow-lg max-w-sm"
  role="status"
  aria-live="polite"
>
  <svg
    class="w-5 h-5 text-green-400 mt-0.5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-white">Changes saved</p>
    <p class="text-xs text-(--color-text-secondary) mt-0.5">
      Your design has been updated successfully.
    </p>
  </div>
</div>
```

## Badges & Tags

```html
<span
  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-(--color-accent)/10 text-(--color-accent)"
>
  Active
</span>

<span
  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/10 text-yellow-400"
>
  Pending
</span>

<!-- Status pill with dot -->
<span
  class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400"
>
  <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
  Online
</span>
```

## Alerts

```html
<!-- Info -->
<div class="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
  <svg
    class="w-4 h-4 text-blue-400 mt-0.5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
  <div>
    <span class="font-medium text-blue-300">Info</span>
    <p class="text-blue-400/80 mt-0.5">Informational message.</p>
  </div>
</div>

<!-- Error -->
<div
  class="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm"
  role="alert"
>
  <svg
    class="w-4 h-4 text-red-400 mt-0.5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
  <div>
    <span class="font-medium text-red-300">Error</span>
    <p class="text-red-400/80 mt-0.5">Something went wrong. Please try again.</p>
  </div>
</div>
```

## Empty State

```html
<div class="flex flex-col items-center justify-center py-16 text-center">
  <div class="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
    <svg
      class="w-6 h-6 text-gray-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  </div>
  <h3 class="text-lg font-medium text-white mb-1">No projects yet</h3>
  <p class="text-sm text-(--color-text-secondary) max-w-xs mb-4">
    Create your first project to get started.
  </p>
  <button
    class="px-4 py-2 bg-(--color-accent) text-white text-sm font-medium rounded-lg transition-all duration-150 hover:opacity-90"
  >
    New Project
  </button>
</div>
```

## Loading Skeleton

```html
<div class="space-y-4">
  <div class="h-4 bg-white/5 rounded w-3/4 animate-pulse"></div>
  <div class="h-4 bg-white/5 rounded w-1/2 animate-pulse"></div>
  <div class="h-32 bg-white/5 rounded animate-pulse"></div>
</div>
```

## Divider

```html
<hr class="border-white/10" />
```

## Patterns

- Stack components with `space-y-4` for vertical layout, `space-x-4` for horizontal.
- Use `gap` in flex/grid containers.
- Keep consistent padding (`p-5` or `p-6`) across similar components.
- Every interactive element needs: hover state, focus state (`focus:ring-2`), and active state (`active:scale-[0.97]` or `active:opacity-90`).
- Use `tabular-nums` class on all numeric data for aligned columns.
- Icons should be 16–20px with 1.5–2px stroke width for consistency.
