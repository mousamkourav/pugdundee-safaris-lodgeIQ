# LodgeIQ — Design System (Pugdundee Safaris)

LodgeIQ is an internal product **under the Pugdundee Safaris umbrella**. Its look must feel
like part of the brand: the earthy olive-and-gold palette from the logo, clean typography,
and the Pugdundee mark on the login and sidebar. This file is the source of truth for the
app's visuals — Claude Code should apply these tokens everywhere and never invent new colours.

Brand colours were sampled directly from the official logo files.

---

## 1. Brand colours (sampled from the logo)

| Token | Hex | Where it comes from | Use for |
|-------|-----|---------------------|---------|
| **Olive (primary)** | `#907A17` | Paw print + wordmark | Primary buttons, links, active states, headers, key figures |
| **Gold (accent)** | `#DAB705` | Footprint + logo ring | Accents, active-nav indicator, focus rings, chart highlight, badges |

These two are the identity. Everything else (neutrals, success/warning/error) supports them.

### Primary — Olive scale
```
olive-50  #FAF8EC
olive-100 #F2EECB
olive-200 #E6DE9E
olive-300 #D3C766
olive-400 #B9A63A
olive-500 #9E8A20
olive-600 #907A17   ← BRAND primary
olive-700 #756213
olive-800 #5A4B10
olive-900 #40360C
```

### Accent — Gold scale
```
gold-50  #FDF8E3
gold-100 #FBEFB8
gold-200 #F6E27E
gold-300 #EFD23F
gold-400 #E4C316
gold-500 #DAB705   ← BRAND accent
gold-600 #B89804
gold-700 #8F7503
gold-800 #6B5802
gold-900 #4A3D01
```

### Neutrals — warm "stone" (not cold grey; keeps the earthy feel)
```
sand-50  #FAF9F6   ← app background
sand-100 #F3F1EA   ← cards / subtle fills
sand-200 #E7E3D8   ← borders / dividers
sand-300 #D3CDBE
sand-400 #A9A290   ← muted text / icons
sand-500 #837D6B
sand-600 #625D4F   ← secondary text
sand-700 #48453A
sand-800 #2E2C25   ← primary text
sand-900 #1B1A15   ← headings
```

### Semantic (tuned to sit beside olive/gold, not clash)
| Purpose | Main | Soft background | Notes |
|---------|------|-----------------|-------|
| Success | `#4E7A3A` (forest) | `#EAF1E4` | Paid, present, on-time |
| Warning | `#C2751A` (amber) | `#FBEFD9` | Due-soon, low stock — deliberately more **orange** than brand gold so alerts don't blend in |
| Error / Critical | `#A83A2C` (brick) | `#F7E3DF` | Overdue safety item, failed |
| Info | `#2F6E78` (teal) | `#E1EEF0` | Neutral notices |

> Accessibility: brand **gold `#DAB705` fails contrast for small text on white** — never use it for body text. Use olive-700/800 or sand-800 for text; use gold only for fills, accents, and large/bold elements. Olive `#907A17` on white is fine for buttons and bold labels.

---

## 2. Typography

The logo wordmark is custom hand-lettering — **use the logo image for the brand mark; do not try to reproduce that font in the UI.** For the app itself, use clean, legible fonts that pair well with the earthy brand and handle data/tables/numbers well.

- **Headings / display:** **Poppins** (600/700) — friendly, geometric, modern; complements the rounded logo.
- **Body / UI / tables / numbers:** **Inter** (400/500/600) — excellent legibility; use its **tabular figures** for all numeric columns and money.
- Both are free Google Fonts; load via `next/font/google` (no layout shift).
- *(Optional, sparingly)* a hero/login greeting can use **Caveat** to echo the handwritten logo — never for UI, labels, or data.

```ts
// app/fonts.ts
import { Poppins, Inter } from "next/font/google";
export const display = Poppins({ subsets: ["latin"], weight: ["600","700"], variable: "--font-display" });
export const sans    = Inter({ subsets: ["latin"], weight: ["400","500","600"], variable: "--font-sans" });
```

**Type scale (rem):** h1 2.0 / h2 1.5 / h3 1.25 / body 1.0 / small 0.875 / caption 0.75. Headings use `--font-display`; everything else `--font-sans`. Numbers in tables: `font-variant-numeric: tabular-nums;`.

---

## 3. Ready-to-paste tokens

### `app/globals.css` (CSS variables + Tailwind v4 `@theme`)
```css
@import "tailwindcss";

:root {
  /* brand */
  --olive-50:#FAF8EC; --olive-100:#F2EECB; --olive-200:#E6DE9E; --olive-300:#D3C766;
  --olive-400:#B9A63A; --olive-500:#9E8A20; --olive-600:#907A17; --olive-700:#756213;
  --olive-800:#5A4B10; --olive-900:#40360C;
  --gold-50:#FDF8E3; --gold-100:#FBEFB8; --gold-200:#F6E27E; --gold-300:#EFD23F;
  --gold-400:#E4C316; --gold-500:#DAB705; --gold-600:#B89804; --gold-700:#8F7503;
  --gold-800:#6B5802; --gold-900:#4A3D01;
  --sand-50:#FAF9F6; --sand-100:#F3F1EA; --sand-200:#E7E3D8; --sand-300:#D3CDBE;
  --sand-400:#A9A290; --sand-500:#837D6B; --sand-600:#625D4F; --sand-700:#48453A;
  --sand-800:#2E2C25; --sand-900:#1B1A15;
  --success:#4E7A3A; --success-bg:#EAF1E4;
  --warning:#C2751A; --warning-bg:#FBEFD9;
  --error:#A83A2C;   --error-bg:#F7E3DF;
  --info:#2F6E78;    --info-bg:#E1EEF0;

  /* semantic roles */
  --background:var(--sand-50);
  --surface:#FFFFFF;
  --border:var(--sand-200);
  --text:var(--sand-800);
  --text-muted:var(--sand-600);
  --primary:var(--olive-600);
  --primary-hover:var(--olive-700);
  --accent:var(--gold-500);
  --ring:var(--gold-500);
  --radius:0.625rem;
}

/* Tailwind v4: expose tokens as utilities (bg-primary, text-olive-600, etc.) */
@theme inline {
  --color-background:var(--background);
  --color-surface:var(--surface);
  --color-border:var(--border);
  --color-primary:var(--primary);
  --color-accent:var(--accent);
  --color-olive-600:var(--olive-600);
  --color-gold-500:var(--gold-500);
  --font-sans:var(--font-sans);
  --font-display:var(--font-display);
  /* add the rest of the olive/gold/sand steps the same way as needed */
}

body { background:var(--background); color:var(--text); font-family:var(--font-sans); }
h1,h2,h3 { font-family:var(--font-display); color:var(--sand-900); }
.tabular { font-variant-numeric: tabular-nums; }
```

*If the project uses Tailwind v3 instead*, put the same hex scales under `theme.extend.colors.{olive,gold,sand}` in `tailwind.config.js` and the CSS variables in `globals.css`.

---

## 4. Component styling rules

- **Buttons** — Primary: `bg-[--primary] text-white hover:bg-[--primary-hover]`. Secondary: `bg-sand-100 text-sand-800 border border-sand-200`. Destructive: `bg-[--error] text-white`. Radius `--radius`, medium weight, comfortable padding.
- **Sidebar** — *Default:* light (`bg-surface`, `border-r border-sand-200`), nav labels in sand-700, **active item = olive text + a gold left-border/indicator + olive-50 fill**. Pugdundee horizontal logo at top. *(Optional dark variant: `bg-olive-900` with gold active indicator for a premium safari feel.)*
- **Cards / KPI tiles** — `bg-surface border border-sand-200 rounded-[--radius]`, soft shadow, olive-600 for the headline number, sand-600 label, a small gold accent line or icon.
- **Tables** — sand-100 header, sand-200 row dividers, tabular numbers right-aligned, hover row `bg-sand-50`. Status via semantic **badges** (soft bg + darker text), e.g. Overdue = error-bg/error, Due soon = warning-bg/warning, Paid/Present = success-bg/success.
- **Forms** — labels sand-700, inputs `border-sand-300 focus:ring-2 focus:ring-[--ring]`, inline zod validation errors in `--error`. Required fields marked; auto-calculated fields shown read-only with a subtle sand-100 fill.
- **Charts (Tremor/Recharts)** — primary series olive-600, secondary gold-500, then teal `#2F6E78` and forest `#4E7A3A`; grid lines sand-200; keep it calm, not rainbow.
- **Focus & a11y** — always a visible `--ring` (gold) focus outline; body text stays sand-800 on light for AA contrast.

---

## 5. Logo usage

Files are in `public/`:
- `pugdundee-logo-horizontal.jpeg` → **sidebar top** and **login screen** (works on light backgrounds).
- `pugdundee-logo-circle.jpeg` → **favicon**, compact/collapsed sidebar, and user-menu/app avatar.

Rules: keep clear space around the mark, don't recolour or stretch it, don't place the light-background logo on olive/gold fills. **Ask the design team for transparent PNG or SVG versions** when possible — cleaner than the JPEGs, especially for the favicon and any dark sidebar.

**App naming:** present it as a Pugdundee product — e.g. show *"LodgeIQ"* with a *"by Pugdundee Safaris"* lockup, or simply *"Pugdundee Lodge Manager."* Put the logo, not just text, in the header.

---

## 6. Feel
Earthy, calm, premium, trustworthy — like the lodges. Generous whitespace, warm sand
backgrounds (not stark white-grey), olive for action, gold for small moments of emphasis.
It should look like Pugdundee built it, not a generic admin template.
