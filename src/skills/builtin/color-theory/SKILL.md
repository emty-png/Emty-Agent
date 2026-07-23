---
name: color-theory
description: Color theory, palette generation, contrast ratios, dark/light mode systems, and semantic color naming for design projects.
tags: color, palette, theme, dark-mode, light-mode, contrast, design
when_to_use: Use in design mode when selecting colors, building a palette, or implementing dark/light themes
modes: design
---

Color theory and palette systems for design projects. Covers palette structure, design directions, contrast requirements, and dark/light mode implementation.

---

# Palette Structure

A coherent palette has four layers. Plan all four before writing any CSS.

| Layer            | Share of pixels | Tokens                                                                                          |
| ---------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| **Neutrals**     | 70–90%          | `--color-bg`, `--color-bg-elevated`, `--color-text`, `--color-text-secondary`, `--color-border` |
| **Accent** (one) | 5–10%           | `--color-accent` only — never invent a second accent                                            |
| **Semantic**     | 0–5%            | success, warn, danger                                                                           |
| **Effect**       | <1%             | gradients, glows; rarely justified                                                              |

## Accent Discipline

- **At most 2 visible uses of `--color-accent` per screen.** Typical pair: one eyebrow/chip + one primary CTA. Or one accent card + one tab pill.
- Links count as accent; demote to `--color-text` underline if you also have a CTA on the same screen.
- Hover/focus rings count as accent. Ration accordingly.

## Semantic Color Naming

Always name tokens by **purpose**, never by hue:

```css
/* good */
--color-accent: #2f6feb;
--color-success: #17a34a;

/* bad — locks you out of theming */
--blue-500: #2f6feb;
--green-500: #17a34a;
```

---

# Contrast Requirements

| Pair                                    | Minimum   |
| --------------------------------------- | --------- |
| Body text (≤16 px) on background        | **4.5:1** |
| Large text (>18 px or 14 px bold)       | **3:1**   |
| UI components against adjacent surfaces | **3:1**   |

Use https://webaim.org/resources/contrastchecker/ to verify contrast ratios.

---

# Dark & Light Themes

## Dark Theme Rules

Avoid pure black and pure white — both cause vibration and eye strain.

| Token      | Dark theme             | Light theme            |
| ---------- | ---------------------- | ---------------------- |
| Background | `#0f0f0f` (not `#000`) | `#fafafa` (not `#fff`) |
| Foreground | `#f0f0f0` (not `#fff`) | `#111111` (not `#000`) |

On dark surfaces, prefer **semi-transparent white borders** over solid dark borders — `rgba(255,255,255,0.08)` reads as structure without adding visual noise.

## Applying a Theme

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

**Posture:** Serif display, sans body, mono for metadata only. No shadows, no rounded cards — borders + whitespace do the work. One decisive image, cropped only at the bottom.

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

**Posture:** Tight letter-spacing on display sizes (-0.02em). Hairline borders only, no shadows except dropdowns/modals. Mono numerics with `font-variant-numeric: tabular-nums`.

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

**Posture:** Sans display with strong weight contrast, system body for readability. Comfortable radii (12–18px) paired with crisp grid alignment.

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

**Posture:** Tabular numerics everywhere, mono for code / IDs / hashes. Dense tables with hairline borders, no row striping.

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

**Posture:** Display = serif at extreme sizes (clamp(48px, 8vw, 120px)). Body = monospace. Borders are full-strength fg (1.5–2px). Asymmetric layouts: one column 70%, the other 30%.

---

# Quick Color Palettes

For fast color swaps without a full direction. Apply via the same `:root` block above.

## Midnight

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

## Ember

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

## Ocean

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

## Forest

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

## Lavender

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

## Rose Gold

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

## Neon

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

## Sunset

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

---

# Rules

- Always define `--color-bg`, `--color-text`, and `--color-accent` at minimum
- Ensure contrast ratio >= 4.5:1 between text and background
- Use `--color-bg-elevated` for cards, modals, and overlays
- Use `--color-border` for all borders — never hardcode `border-white/10`
- When a direction is chosen, apply its full font + palette + posture; don't pick just the colors
