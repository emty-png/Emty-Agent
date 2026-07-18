---
name: design-themes
description: Design directions and curated theme palettes for design canvas artifacts. Provides 5 richly-specified design directions (Editorial, Modern Minimal, Human, Tech Utility, Brutalist) plus 10 color palettes.
tags: themes, colors, palettes, dark-mode, light-mode, design, directions
when_to_use: Use in design mode when selecting or applying a color theme or visual direction to a design
modes: design
---

Design directions and color palettes for design canvas artifacts. Each design direction specifies a complete visual system: font stacks, palette, layout posture, and real-world references. The 10 quick palettes are for fast color swaps without full direction specs.

## How to Apply

Add this to the `css` field at the top:

```css
:root {
  --color-bg: #0a0a1a;
  --color-bg-elevated: #12122a;
  --color-bg-card: #1a1a3a;
  --color-text: #e8e8f0;
  --color-text-secondary: #8888aa;
  --color-accent: #6c63ff;
  --color-accent-light: #8b83ff;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.4);
  --font-display: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
}
```

Then use Tailwind with these variables: `bg-(--color-bg)`, `text-(--color-text)`, `border-(--color-border)`.

---

# Design Directions

Choose one direction that matches the brief's tone. Each direction is a complete visual system — font stacks, palette, layout rules, and references. Apply the full direction; don't mix and match across directions.

## 1. Editorial

**Mood:** Print-magazine feel. Generous whitespace, large serif headlines, restrained palette of neutral paper + ink + a single brand accent. For publishing, editorial, magazine, and content-heavy briefs.

**References:** Monocle, The Financial Times Weekend, NYT Magazine, It's Nice That

**Fonts:**

```css
:root {
  --font-display: 'Iowan Old Style', 'Charter', Georgia, serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
```

**Palette:**

```css
:root {
  --color-bg: #f8f7f4;
  --color-bg-elevated: #ffffff;
  --color-bg-card: #f0efe8;
  --color-text: #1a1a18;
  --color-text-secondary: #5a5a50;
  --color-accent: #c4392d;
  --color-accent-light: #d94f42;
  --color-border: rgba(0, 0, 0, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.06);
}
```

**Posture:**

- Serif display, sans body, mono for metadata only
- No shadows, no rounded cards — borders + whitespace do the work
- One decisive image, cropped only at the bottom
- Kicker/eyebrow in mono uppercase, one accent color used at most twice
- Never create peach/pink/orange-beige page washes unless the brand requires them

---

## 2. Modern Minimal

**Mood:** Quiet, precise, software-native. System fonts, crisp neutral foundations, small but visible product palette. The interface feels shipped rather than greyscale.

**References:** Linear, Vercel, Notion, Stripe docs

**Fonts:**

```css
:root {
  --font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}
```

**Palette (dark):**

```css
:root {
  --color-bg: #08090a;
  --color-bg-elevated: #191a1b;
  --color-bg-card: #1e2024;
  --color-text: #f7f8f8;
  --color-text-secondary: #8a8f98;
  --color-accent: #5e6ad2;
  --color-accent-light: #7170ff;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.4);
}
```

**Palette (light):**

```css
:root {
  --color-bg: #fafafa;
  --color-bg-elevated: #ffffff;
  --color-bg-card: #f3f4f5;
  --color-text: #111111;
  --color-text-secondary: #666666;
  --color-accent: #5e6ad2;
  --color-accent-light: #7170ff;
  --color-border: rgba(0, 0, 0, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.06);
}
```

**Posture:**

- Tight letter-spacing on display sizes (-0.02em)
- Hairline borders only, no shadows except dropdowns/modals
- Mono numerics with `font-variant-numeric: tabular-nums`
- Sticky frosted nav, content-led layouts
- Controlled color system: primary action + one secondary signal + status colors

---

## 3. Human / Approachable

**Mood:** Friendly and tactile without the generic cozy canvas. Clean neutral background, product-led color system, generous radii, clear hierarchy. Good for consumer tools, marketplaces, wellness, education, AI assistants.

**References:** Airbnb, Duolingo, Miro, Mercury

**Fonts:**

```css
:root {
  --font-display: 'Avenir Next', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}
```

**Palette:**

```css
:root {
  --color-bg: #f7f8f8;
  --color-bg-elevated: #ffffff;
  --color-bg-card: #f0f1f2;
  --color-text: #1a1d23;
  --color-text-secondary: #5f6672;
  --color-accent: #0ea5a0;
  --color-accent-light: #14b8a6;
  --color-border: rgba(0, 0, 0, 0.06);
  --color-shadow: rgba(0, 0, 0, 0.06);
}
```

**Posture:**

- Sans display with strong weight contrast, system body for readability
- Comfortable radii (12–18px) paired with crisp grid alignment
- Primary action color plus secondary/domain accent and clear status colors
- Subtle elevation only on interactive cards
- Avoid generic pastel/beige gradients; use real product screenshots or labelled placeholders

---

## 4. Tech / Utility

**Mood:** Data-dense, monospace-friendly, dark or light + grid. Made for engineers and operators who want information per square inch, not vibes.

**References:** Datadog, GitHub, Cloudflare dashboard, Sentry

**Fonts:**

```css
:root {
  --font-display: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
}
```

**Palette:**

```css
:root {
  --color-bg: #f8f9fb;
  --color-bg-elevated: #ffffff;
  --color-bg-card: #f0f2f5;
  --color-text: #1a1d23;
  --color-text-secondary: #5f6672;
  --color-accent: #16a34a;
  --color-accent-light: #22c55e;
  --color-border: rgba(0, 0, 0, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.06);
}
```

**Posture:**

- Sans display + sans body (one family) is OK — utility trumps editorial
- Tabular numerics everywhere, mono for code / IDs / hashes
- Dense tables with hairline borders, no row striping
- Inline status pills (success / warn / danger) with restrained tinted backgrounds
- Avoid: hero images, oversized headlines, marketing copy — show the product instead

---

## 5. Brutalist / Experimental

**Mood:** Loud type. Visible grid. System sans + a single oversized serif. Deliberate roughness as confidence. Great for art, indie, agency, manifesto pages.

**References:** Are.na, Yale Center for British Art, mschf, Read.cv

**Fonts:**

```css
:root {
  --font-display: 'Times New Roman', 'Iowan Old Style', Georgia, serif;
  --font-body: ui-monospace, 'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace;
}
```

**Palette:**

```css
:root {
  --color-bg: #f0f0ec;
  --color-bg-elevated: #ffffff;
  --color-bg-card: #e8e8e4;
  --color-text: #0a0a08;
  --color-text-secondary: #555550;
  --color-accent: #d4380d;
  --color-accent-light: #e85d2c;
  --color-border: #0a0a08;
  --color-shadow: rgba(0, 0, 0, 0.1);
}
```

**Posture:**

- Display = serif at extreme sizes (clamp(48px, 8vw, 120px))
- Body = monospace — yes, monospace as body, deliberately
- Borders are full-strength fg (1.5–2px), not muted greys
- Asymmetric layouts: one column 70%, the other 30%
- Almost no border-radius (0–2px). No shadows. No gradients.
- Underline links, no hover decoration — let the typography carry it

---

## Quick Color Palettes

For fast color swaps without a full direction. Apply via the same `:root` block above.

### Midnight

```css
:root {
  --color-bg: #0a0e1a;
  --color-bg-elevated: #111827;
  --color-bg-card: #1e293b;
  --color-text: #e2e8f0;
  --color-text-secondary: #94a3b8;
  --color-accent: #3b82f6;
  --color-accent-light: #60a5fa;
  --color-border: rgba(255, 255, 255, 0.07);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Ember

```css
:root {
  --color-bg: #0f0a07;
  --color-bg-elevated: #1a1410;
  --color-bg-card: #261e16;
  --color-text: #f5e6d3;
  --color-text-secondary: #b89a7a;
  --color-accent: #f59e0b;
  --color-accent-light: #fbbf24;
  --color-border: rgba(255, 255, 255, 0.06);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Ocean

```css
:root {
  --color-bg: #071a1f;
  --color-bg-elevated: #0f2a30;
  --color-bg-card: #163a42;
  --color-text: #e0f2f7;
  --color-text-secondary: #7fb8c8;
  --color-accent: #06b6d4;
  --color-accent-light: #22d3ee;
  --color-border: rgba(255, 255, 255, 0.07);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Forest

```css
:root {
  --color-bg: #071a0f;
  --color-bg-elevated: #0f2a18;
  --color-bg-card: #163a22;
  --color-text: #e0f7e8;
  --color-text-secondary: #7fb89a;
  --color-accent: #22c55e;
  --color-accent-light: #4ade80;
  --color-border: rgba(255, 255, 255, 0.06);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Lavender

```css
:root {
  --color-bg: #0f0a1a;
  --color-bg-elevated: #1a1427;
  --color-bg-card: #251e36;
  --color-text: #ede8f5;
  --color-text-secondary: #a898c0;
  --color-accent: #a78bfa;
  --color-accent-light: #c4b5fd;
  --color-border: rgba(255, 255, 255, 0.06);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Rose Gold

```css
:root {
  --color-bg: #1a0a0f;
  --color-bg-elevated: #27141c;
  --color-bg-card: #361e28;
  --color-text: #f5e8ed;
  --color-text-secondary: #c898a8;
  --color-accent: #f43f5e;
  --color-accent-light: #fb7185;
  --color-border: rgba(255, 255, 255, 0.06);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Arctic

```css
:root {
  --color-bg: #0c1220;
  --color-bg-elevated: #141c2e;
  --color-bg-card: #1e2a40;
  --color-text: #e8edf5;
  --color-text-secondary: #8898b8;
  --color-accent: #60a5fa;
  --color-accent-light: #93c5fd;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Neon

```css
:root {
  --color-bg: #050505;
  --color-bg-elevated: #0a0a0a;
  --color-bg-card: #111111;
  --color-text: #f0f0f0;
  --color-text-secondary: #888888;
  --color-accent: #39ff14;
  --color-accent-light: #7fff5e;
  --color-border: rgba(255, 255, 255, 0.1);
  --color-shadow: rgba(0, 0, 0, 0.6);
}
```

### Sunset

```css
:root {
  --color-bg: #1a0f0a;
  --color-bg-elevated: #271a12;
  --color-bg-card: #36241a;
  --color-text: #f5ebe3;
  --color-text-secondary: #c8a888;
  --color-accent: #fb923c;
  --color-accent-light: #fdba74;
  --color-border: rgba(255, 255, 255, 0.06);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

### Monochrome

```css
:root {
  --color-bg: #0a0a0a;
  --color-bg-elevated: #141414;
  --color-bg-card: #1e1e1e;
  --color-text: #f0f0f0;
  --color-text-secondary: #888888;
  --color-accent: #d4d4d4;
  --color-accent-light: #e8e8e8;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.5);
}
```

---

## Light Theme Template

For light designs, use this base and customize:

```css
:root {
  --color-bg: #fafafa;
  --color-bg-elevated: #ffffff;
  --color-bg-card: #f5f5f5;
  --color-text: #111111;
  --color-text-secondary: #666666;
  --color-accent: #3b82f6;
  --color-accent-light: #2563eb;
  --color-border: rgba(0, 0, 0, 0.08);
  --color-shadow: rgba(0, 0, 0, 0.08);
}
```

---

## Rules

- Always define `--color-bg`, `--color-text`, and `--color-accent` at minimum
- Ensure contrast ratio >= 4.5:1 between text and background
- Use `--color-bg-elevated` for cards, modals, and overlays
- Use `--color-border` for all borders — never hardcode `border-white/10`
- The agent can create new palettes by combining elements or inventing fresh ones
- Name custom palettes descriptively when creating new ones
- When a direction is chosen, apply its full font + palette + posture; don't pick just the colors
