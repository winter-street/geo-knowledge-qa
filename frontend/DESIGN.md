# Frontend Design Spec — 「政策期刊」Policy Journal

> Source of truth for all frontend visual decisions. Read this before touching any `<style>` or CSS variable.

## Philosophy

Warm, authoritative, editorial. Inspired by government research publications and academic journals — not SaaS startups. The tool should feel like consulting a policy document, not chatting with a bot.

**DNA**: Stripe Press (cream + ink + editorial serif) × Pentagram (typographic weight) × Notion (content warmth).

## Color Palette

### Ink Scale (warm grays, not cool)
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-ink-900` | `#1A1A2E` | Headings, primary text, dark buttons |
| `--color-ink-700` | `#2D2D3A` | Body text |
| `--color-ink-500` | `#6B6B78` | Secondary text, labels |
| `--color-ink-300` | `#A8A8B2` | Placeholders, muted text |
| `--color-ink-200` | `#D4D2CC` | Scrollbar thumb |
| `--color-ink-100` | `#E2DFD6` | Borders, hairlines |
| `--color-ink-50` | `#F0EDE5` | Table header bg |

### Brand
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#2E7D5B` | Forest green — links, active states, accents |
| `--color-primary-hover` | `#246B4C` | Hover darkening |
| `--color-primary-light` | `#E8F5EF` | Active item bg, success bg |
| `--color-primary-ghost` | `rgba(46,125,91,0.06)` | Subtle tint |
| `--color-accent` | `#1E3A5F` | Institutional blue — secondary accent only |
| `--color-accent-light` | `#EBF0F7` | Blue tint bg |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#2E7D5B` | Same as primary |
| `--color-success-light` | `#E8F5EF` | |
| `--color-warning` | `#B8860B` | Dark gold |
| `--color-warning-light` | `#FDF6E3` | |
| `--color-danger` | `#B83A1F` | Brick red |
| `--color-danger-light` | `#FCEEE9` | |

### Surfaces
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-surface` | `#FFFFFF` | Cards, topbar |
| `--color-bg` | `#FEFDF9` | Page background (warm white) |
| `--color-bg-subtle` | `#F8F6F0` | Sidebar bg, input bg |
| `--color-sidebar` | `#F8F6F0` | Same as bg-subtle |
| `--color-sidebar-active` | `#E8F5EF` | Same as primary-light |

## Typography

| Role | Typeface | Weight | Usage |
|------|----------|--------|-------|
| Display | **Source Serif 4** | 400, 600, 700 | Page titles, section headers, stat numbers, logo text |
| Body | **Inter** | 400, 500, 600 | All body text, buttons, labels |
| CJK fallback | PingFang SC / Microsoft YaHei | — | Chinese characters |

### Scale
- Page title: `font-family: var(--font-display); font-size: 16px; font-weight: 600;`
- Section header: `font-family: var(--font-display); font-size: 15-20px; font-weight: 600-700;`
- Stat number: `font-family: var(--font-display); font-size: 28px; font-weight: 700;`
- Body: `font-size: 14px; line-height: 1.8;`
- Labels: `font-size: 10-11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;`

## Spacing & Radius

### Radius (near-zero, editorial)
- `--radius-sm`: `2px`
- `--radius-md`: `4px`
- `--radius-lg`: `6px`
- **Never above 6px.** No pill shapes (border-radius: 99px) except status tags.

### Shadows (minimal)
- `--shadow-sm`: `0 1px 2px rgba(0,0,0,0.04)`
- `--shadow-md`: `0 2px 8px rgba(0,0,0,0.06)`
- **No colored shadows. No glow. No box-shadow on buttons.**

## Component Patterns

### Buttons
- **Primary**: `background: var(--color-ink-900); color: #fff; border-radius: var(--radius-md); letter-spacing: 0.06-0.08em;`
- **Hover**: `background: var(--color-ink-700);` (lighter, not darker)
- **No gradient. No translateY. No box-shadow on buttons.**
- **Accent button**: `background: var(--color-primary);` (forest green, used sparingly)

### Inputs
- **Style**: Underline-only — `border: none; border-bottom: 1px solid var(--color-ink-100);`
- **Focus**: `border-bottom-color: var(--color-primary);`
- **Login page uses this style. Q&A search uses 1px full border for usability.**

### Tables
- **Header**: `background: var(--color-bg-subtle); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;`
- **Row hover**: `background: rgba(0,0,0,0.01);` (barely visible)
- **No rounded corners on table.**

### Status Tags
- `padding: 2px 10px; border-radius: var(--radius-md); font-size: 11px;`
- Done: green bg/text. Processing: gold bg/text. Pending: gray. Failed: brick red.

### Source Citations
- Academic style: `[1] 文档标题 p.23` with italic serif bracket number in primary color.
- Not pills, not chips. Plain text with colored marker.

### Sidebar Navigation
- Background: `var(--color-bg-subtle)` (warm, not white)
- Active item: `border-left: 2px solid var(--color-primary);`
- Logo: ink-900 square with serif "GK" text (not gradient)

## Anti-Slop Rules (Hard Constraints)

| Forbidden | Why | Use Instead |
|-----------|-----|-------------|
| Purple/violet gradients | AI training data universal formula | Solid color buttons |
| Gradient mesh orbs | AI-generated background cliché | Clean whitespace or hairline rule |
| Inter as display font | Too common, no design signal | Source Serif 4 for headings |
| Emoji as icons | Unprofessional | SVG stroke icons (1.5px weight) |
| `transform: translateY(-1px)` hover | Every AI button does this | Color change only |
| `border-radius > 6px` | Gumdrop look | Sharp editorial corners |
| Colored shadows / glow | SaaS neon cliché | Minimal neutral shadows |
| Pill-shaped buttons | Too rounded | `border-radius: 4px` |

## Chinese Typography

- Use「」for quotes, not ""
- `letter-spacing: 0.02em` on Chinese body text for readability
- Source Serif 4 pairs with Noto Serif SC for CJK serif rendering

## File References

| What | Where |
|------|-------|
| Design tokens | `src/styles/global.css` |
| Font import | `index.html` (Google Fonts link) |
| Shell layout | `src/App.vue` |
| Design demo | `frontend/design-demos/v2-policy-journal.html` |
| Original Direction A | `frontend/design-demos/direction-a-notion-forward.html` |
