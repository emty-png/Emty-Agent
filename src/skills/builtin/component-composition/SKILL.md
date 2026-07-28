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

Prefer composable pieces over a single component with many props. Use card-header, card-body, card-footer wrappers instead of a monolithic Card component with 15+ props.

## Slot Patterns

Use named sections for flexibility: header slot, content slot, and footer slot. Each section should be independently swappable.

---

# State Coverage

The single most reliable AI-design failure is shipping only the populated state. Every interactive surface must address all five:

- **Loading**: Skeleton, spinner, or shell
- **Empty**: Headline, plain explanation, primary CTA
- **Error**: Plain-language cause, recovery action, preserved user input
- **Populated**: The state the design was actually drawn for
- **Edge**: Extreme volume, long strings, missing optional fields

When you don't have a real value, leave a short honest placeholder ("—", a grey block, a labelled stub) instead of inventing one. An honest placeholder beats a fake stat.

---

# Buttons

- **Primary**: Use `bg-(--color-accent) text-white` with `hover:opacity-90 active:scale-[0.97]`
- **Secondary / Ghost**: Use `bg-transparent text-(--color-text-secondary) border border-white/10` with `hover:bg-white/5`
- **Danger**: Use `bg-red-500/10 text-red-400 border border-red-500/20` with `hover:bg-red-500/20`
- **Icon button**: Minimum 44px touch target (`w-10 h-10`), use `rounded-lg hover:bg-white/5`
- **Loading state**: Use `opacity-75 cursor-not-allowed disabled` with an animated spinner SVG inside

---

# Cards

- **Basic card**: Use `p-6 rounded-xl border border-white/10 bg-white/5`
- **Interactive card**: Add `transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08] cursor-pointer` and use `group` for hover effects on children
- **Stat card**: Use `p-5 rounded-xl bg-white/5 border border-white/10` with uppercase tracking-widest label and tabular-nums for numbers
- **Card with image**: Use `rounded-xl overflow-hidden border border-white/10 bg-white/5` with an `aspect-video` image area

---

# Modals / Dialogs

- **Backdrop**: Use `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center`
- **Dialog**: Use `w-full max-w-md p-6 rounded-2xl border border-white/10 bg-[#1a1a2e] shadow-2xl`
- Include title, description, and a flex row of Cancel/Confirm buttons at the end

---

# Forms

- Wrap inputs in `space-y-6` container with `space-y-2` per field group
- Use `rounded-lg border border-(--color-border) bg-(--color-bg-elevated)` for all inputs
- Add `focus:outline-none focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent)/20 transition-colors duration-150`
- Textarea: add `min-h-[120px] resize-y`
- Checkbox: use `flex items-center gap-3 cursor-pointer` wrapper

---

# Navigation

- **Tab navigation**: Use `flex border-b border-(--color-border)` with tabs using `px-4 py-3 text-sm font-medium`. Active tab gets `border-b-2 border-(--color-accent) text-(--color-accent)`, inactive gets `text-(--color-text-secondary) hover:text-(--color-text)`
- **Sidebar navigation**: Use `space-y-1` with links using `flex items-center gap-3 px-3 py-2 rounded-lg`. Active gets `bg-(--color-accent)/10 text-(--color-accent)`, inactive gets `hover:bg-white/5`

---

# Tables

- Wrap in `overflow-x-auto rounded-xl border border-white/10`
- Header row: `border-b border-white/10 bg-white/5` with `px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-secondary)`
- Data rows: `border-b border-white/5 hover:bg-white/[0.02] transition-colors`
- Use `tabular-nums` for numeric columns

---

# Badges & Tags

- **Default**: `bg-white/10 text-(--color-text)`
- **Success**: `bg-green-500/10 text-green-400`
- **Warning**: `bg-yellow-500/10 text-yellow-400`
- **Error**: `bg-red-500/10 text-red-400`
- Use `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium` for all badges

---

# Toasts / Alerts

- Use `flex items-center gap-3 p-4 rounded-lg` with colored background and border
- Success: `bg-green-500/10 border border-green-500/20` with green icon and text
- Error: `bg-red-500/10 border border-red-500/20` with red icon and text
- Warning: `bg-yellow-500/10 border border-yellow-500/20` with yellow icon and text

---

# Empty States

- Center content with `flex flex-col items-center justify-center py-16 text-center`
- Use a large icon in a `w-16 h-16 rounded-full bg-white/5` circle
- Include a headline, description (`text-sm text-(--color-text-secondary) max-w-sm mb-6`), and a primary CTA button

---

# Loading States

- **Spinner**: Use `animate-spin h-8 w-8 text-(--color-accent)` with an SVG circle and path
- **Skeleton**: Use `space-y-4` with `h-4 bg-white/5 rounded` bars at various widths, plus a larger `h-32` block

---

# Checklist

- [ ] All interactive components have hover, focus, and active states
- [ ] Loading, empty, error, populated, and edge states are addressed
- [ ] Touch targets are at least 44x44px
- [ ] Components use consistent spacing and typography
- [ ] States are visually distinct (not just color changes)
