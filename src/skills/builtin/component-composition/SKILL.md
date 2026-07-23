---
name: component-composition
description: Component composition patterns including design patterns, state coverage, slot patterns, and reusable UI component patterns with Tailwind v4.
tags: components, ui, buttons, cards, modals, forms, navigation, tables, composition
when_to_use: Use in design mode when building UI components or designing component systems
modes: design
---

Component composition patterns for design projects. Covers design patterns, state coverage, reusable component patterns, and composition best practices.

---

# Design Patterns

## Composition Over Configuration

Prefer composable pieces over a single component with many props:

```html
<!-- Good: composable pieces -->
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Title</h3>
    <button class="card-action">Edit</button>
  </div>
  <div class="card-body">Content here</div>
  <div class="card-footer">
    <button class="btn btn-primary">Save</button>
  </div>
</div>

<!-- Bad: monolithic component with 15 props -->
<Card title="Title" showEdit action="Save" footerVisible ... />
```

## Slot Patterns

Use named sections for flexibility:

```html
<!-- Header slot -->
<header class="flex items-center justify-between p-4 border-b border-(--color-border)">
  <h2 class="text-lg font-semibold">Title</h2>
  <div class="flex items-center gap-2">
    <!-- Actions slot -->
  </div>
</header>

<!-- Content slot -->
<main class="flex-1 overflow-auto p-6">
  <!-- Primary content -->
</main>

<!-- Footer slot -->
<footer class="p-4 border-t border-(--color-border)">
  <!-- Footer actions -->
</footer>
```

---

# State Coverage

The single most reliable AI-design failure is shipping only the populated state. Every interactive surface must address all five:

| State         | Must contain                                                |
| ------------- | ----------------------------------------------------------- |
| **Loading**   | Skeleton, spinner, or shell                                 |
| **Empty**     | Headline, plain explanation, primary CTA                    |
| **Error**     | Plain-language cause, recovery action, preserved user input |
| **Populated** | The state the design was actually drawn for                 |
| **Edge**      | Extreme volume, long strings, missing optional fields       |

When you don't have a real value, leave a short honest placeholder ("—", a grey block, a labelled stub) instead of inventing one. An honest placeholder beats a fake stat.

---

# Buttons

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

---

# Cards

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

<!-- Card with image -->
<div class="rounded-xl overflow-hidden border border-white/10 bg-white/5">
  <div class="aspect-video bg-(--color-bg-card)"></div>
  <div class="p-4">
    <h3 class="font-semibold">Image Card</h3>
    <p class="text-sm text-(--color-text-secondary) mt-1">Description</p>
  </div>
</div>
```

---

# Modals / Dialogs

```html
<!-- Backdrop -->
<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
  <!-- Dialog -->
  <div class="w-full max-w-md p-6 rounded-2xl border border-white/10 bg-[#1a1a2e] shadow-2xl">
    <h2 class="text-xl font-semibold mb-4">Dialog Title</h2>
    <p class="text-sm text-(--color-text-secondary) mb-6">Dialog description text goes here.</p>
    <div class="flex justify-end gap-3">
      <button class="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5">
        Cancel
      </button>
      <button class="px-4 py-2 text-sm rounded-lg bg-(--color-accent) text-white hover:opacity-90">
        Confirm
      </button>
    </div>
  </div>
</div>
```

---

# Forms

```html
<form class="space-y-6">
  <!-- Text input -->
  <div class="space-y-2">
    <label class="text-sm font-medium">Email</label>
    <input
      type="email"
      class="w-full px-3 py-2 rounded-lg border border-(--color-border) bg-(--color-bg-elevated) text-(--color-text) focus:outline-none focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent)/20 transition-colors duration-150"
      placeholder="you@example.com"
    />
  </div>

  <!-- Textarea -->
  <div class="space-y-2">
    <label class="text-sm font-medium">Message</label>
    <textarea
      class="w-full px-3 py-2 rounded-lg border border-(--color-border) bg-(--color-bg-elevated) text-(--color-text) focus:outline-none focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent)/20 transition-colors duration-150 min-h-[120px] resize-y"
      placeholder="Your message..."
    ></textarea>
  </div>

  <!-- Select -->
  <div class="space-y-2">
    <label class="text-sm font-medium">Category</label>
    <select
      class="w-full px-3 py-2 rounded-lg border border-(--color-border) bg-(--color-bg-elevated) text-(--color-text) focus:outline-none focus:border-(--color-accent)"
    >
      <option>Option 1</option>
      <option>Option 2</option>
    </select>
  </div>

  <!-- Checkbox -->
  <label class="flex items-center gap-3 cursor-pointer">
    <input
      type="checkbox"
      class="w-4 h-4 rounded border-(--color-border) text-(--color-accent) focus:ring-(--color-accent)"
    />
    <span class="text-sm">I agree to the terms</span>
  </label>
</form>
```

---

# Navigation

```html
<!-- Tab navigation -->
<nav class="flex border-b border-(--color-border)">
  <button
    class="px-4 py-3 text-sm font-medium border-b-2 border-(--color-accent) text-(--color-accent)"
  >
    Active Tab
  </button>
  <button
    class="px-4 py-3 text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text) transition-colors"
  >
    Inactive Tab
  </button>
</nav>

<!-- Sidebar navigation -->
<nav class="space-y-1">
  <a
    href="#"
    class="flex items-center gap-3 px-3 py-2 rounded-lg bg-(--color-accent)/10 text-(--color-accent)"
  >
    <span class="w-5 h-5">📊</span>
    Dashboard
  </a>
  <a
    href="#"
    class="flex items-center gap-3 px-3 py-2 rounded-lg text-(--color-text-secondary) hover:bg-white/5 hover:text-(--color-text) transition-colors"
  >
    <span class="w-5 h-5">⚙️</span>
    Settings
  </a>
</nav>
```

---

# Tables

```html
<div class="overflow-x-auto rounded-xl border border-white/10">
  <table class="w-full">
    <thead>
      <tr class="border-b border-white/10 bg-white/5">
        <th
          class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-secondary)"
        >
          Name
        </th>
        <th
          class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-secondary)"
        >
          Status
        </th>
        <th
          class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-(--color-text-secondary)"
        >
          Amount
        </th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
        <td class="px-4 py-3 text-sm">Item Name</td>
        <td class="px-4 py-3">
          <span
            class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400"
          >
            Active
          </span>
        </td>
        <td class="px-4 py-3 text-sm text-right tabular-nums">$1,234</td>
      </tr>
    </tbody>
  </table>
</div>
```

---

# Badges & Tags

```html
<!-- Default badge -->
<span
  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/10 text-(--color-text)"
>
  Default
</span>

<!-- Success badge -->
<span
  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400"
>
  Success
</span>

<!-- Warning badge -->
<span
  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400"
>
  Warning
</span>

<!-- Error badge -->
<span
  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400"
>
  Error
</span>
```

---

# Toasts / Alerts

```html
<!-- Success toast -->
<div class="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
  <span class="text-green-400">✓</span>
  <p class="text-sm text-green-300">Changes saved successfully.</p>
</div>

<!-- Error toast -->
<div class="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
  <span class="text-red-400">✕</span>
  <p class="text-sm text-red-300">Failed to save. Please try again.</p>
</div>

<!-- Warning toast -->
<div class="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
  <span class="text-yellow-400">⚠</span>
  <p class="text-sm text-yellow-300">Your session will expire in 5 minutes.</p>
</div>
```

---

# Empty States

```html
<div class="flex flex-col items-center justify-center py-16 text-center">
  <div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
    <svg
      class="w-8 h-8 text-(--color-text-secondary)"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  </div>
  <h3 class="text-lg font-semibold mb-2">No projects yet</h3>
  <p class="text-sm text-(--color-text-secondary) max-w-sm mb-6">
    Create your first project to get started.
  </p>
  <button
    class="px-4 py-2 rounded-lg bg-(--color-accent) text-white font-medium hover:opacity-90 transition-opacity"
  >
    Create Project
  </button>
</div>
```

---

# Loading States

```html
<!-- Spinner -->
<div class="flex items-center justify-center py-8">
  <svg class="animate-spin h-8 w-8 text-(--color-accent)" viewBox="0 0 24 24">
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
</div>

<!-- Skeleton -->
<div class="space-y-4">
  <div class="h-4 bg-white/5 rounded w-3/4"></div>
  <div class="h-4 bg-white/5 rounded w-1/2"></div>
  <div class="h-32 bg-white/5 rounded"></div>
</div>
```

---

# Checklist

- [ ] All interactive components have hover, focus, and active states
- [ ] Loading, empty, error, populated, and edge states are addressed
- [ ] Touch targets are at least 44x44px
- [ ] Components use consistent spacing and typography
- [ ] States are visually distinct (not just color changes)
