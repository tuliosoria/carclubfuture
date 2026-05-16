# CarClubFuture Design System

Inspired by **maserati.com** (May 2026 capture). Maserati's proprietary assets (the *Everett* typeface and the Trident wordmark) are not redistributable, so this system substitutes open-source equivalents that capture the same restrained Italian-luxury feel while staying legally clean.

> Replaces the previous McLaren-flavored system. Token variable names (`--papaya-*`) are retained for backward compatibility — they now resolve to gold values, so existing utility classes like `bg-papaya` / `text-papaya` automatically render in Trident gold.

---

## 1. Brand Voice

| Attribute | Direction |
|---|---|
| Tone | Italian heritage, restrained confidence. Headlines whisper with weight, not shout. |
| Density | Generous editorial whitespace. Surfaces breathe. |
| Color discipline | Indigo-black canvas. One brand accent (Trident gold) used as punctuation, not decoration. |
| Geometry | Hairline. 0–2px corners. Borders are 1px, never bold. |
| Motion | Slow and deliberate. 200ms ease-in-out. Hover reveals gold underlines, never bounces. |

---

## 2. Color Tokens

Maserati uses a deep indigo-black canvas (warmer than pure black), a single Trident gold accent, and warm ivory ink. We keep CarClubFuture's buy/hold/sell semantics — desaturated so they harmonize with gold rather than fight it.

```css
:root {
  /* Canvas — indigo-black, warmer than pure #000 */
  --background:        #05070d;
  --surface:           #0b0e16;
  --surface-elevated:  #141822;
  --surface-overlay:   #1d2230;

  /* Ink — warm ivory */
  --foreground:        #f4f1e9;
  --foreground-muted:  #b8b3a6;
  --foreground-dim:    #6c6759;

  /* Borders — hairline restraint */
  --border:            #1f2330;
  --border-strong:     #2f3445;

  /* Brand — Trident gold */
  --papaya:            #b9975b;   /* primary accent (name kept for compat) */
  --papaya-hover:      #cdb076;
  --papaya-press:      #9a7d48;
  --papaya-foreground: #05070d;   /* ink on gold */

  /* Semantic signals — desaturated for tonal harmony with gold */
  --buy:               #4ab87a;
  --hold:              #d4a84a;
  --sell:              #c85a5a;
}
```

**Usage rules**

- Gold is reserved for: primary CTAs, active filter chips, hover/focus rings, the wordmark accent, the upside arrow on a positive forecast.
- Never use gold for body copy, large fills, or decorative gradients. It is a punctuation color.
- Buy/Hold/Sell pills retain their semantic meaning — they describe forecasts, not chrome.

---

## 3. Typography

Maserati ships proprietary *Everett* (a geometric humanist sans). We can't use it. The closest open-source pairing — wide-set geometric display + clean humanist body + tabular mono for numbers:

| Role | Family | Source | Weights |
|---|---|---|---|
| Display (H1–H2, hero, overlines) | **Space Grotesk** | next/font/google | 300, 400, 500 |
| Body & UI | **Inter** | next/font/google | 400, 500, 600 |
| Numeric (prices, CAGR, mileage) | **JetBrains Mono** | next/font/google | 400, 500 — tabular figures |

**Scale (rem-based, 16px root)**

| Token | Size / line-height | Weight | Tracking | Case | Use |
|---|---|---|---|---|---|
| `display-2xl` | 5.5rem / 1.0 | 300 | 0 | UPPER | Home hero headline only |
| `display-xl`  | 4rem / 1.05  | 300 | 0 | UPPER | Section openers ("CATALOG", "FORECAST") |
| `display-lg`  | 2.75rem / 1.1 | 500 | 0 | UPPER | Page titles |
| `h1`          | 2rem / 1.15  | 500 | 0 | sentence | Card cluster heads |
| `h2`          | 1.5rem / 1.2 | 500 | 0 | sentence | Sub-sections |
| `h3`          | 1.125rem / 1.3 | 500 | 0 | sentence | Card titles |
| `overline`    | 0.75rem / 1.3 | 500 | 0.18em | UPPER | Eyebrow labels (wider tracking than McLaren) |
| `body`        | 1rem / 1.55  | 400 | 0 | sentence | Default copy |
| `body-sm`     | 0.875rem / 1.5 | 400 | 0 | sentence | Card body, captions |
| `meta`        | 0.75rem / 1.4 | 500 | 0.08em | UPPER | Timestamps, source pills |
| `num-lg`      | 2rem / 1.0 (mono) | 500 | 0 | — | Hero figures (price) |
| `num-md`      | 1.25rem / 1.0 (mono) | 500 | 0 | — | Card figures (CAGR) |

The shift from McLaren's bold 700 weights to Maserati's light 300/500 is the single biggest visual change. Display headlines stay all-caps but lose their motorsport bark — they read like a magazine masthead, not a race banner.

---

## 4. Spacing & Layout

```
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 / 192 px
```

- Content max-width: `1440px` — generous editorial leading.
- Vertical section rhythm: `96px` on desktop between major sections (more than McLaren's 64).
- Card padding: `24px` minimum.
- Hairline rule (`1px var(--border)`) is the dominant divider; no thick separators.

---

## 5. Geometry

- Border radius: `0`, `1px`, or `2px`. Never higher.
- All borders are `1px solid var(--border)` unless an interactive state escalates to `--border-strong`.
- No drop shadows on chrome. Only photos / hero imagery get soft shadows for elevation.

---

## 6. Motion

| Pattern | Duration | Easing |
|---|---|---|
| Hover color / underline | 200ms | ease-in-out |
| Card border lift | 250ms | ease-in-out |
| Image scale (hero) | 400ms | ease-out |
| Modal / drawer | 240ms | ease-in-out |
| Reduced-motion | 0.01ms (all) | linear |

No bounce, no spring, no skeuomorphic flourishes. Maserati's chrome moves like a heavy door — slow and confident.

---

## 7. Component Patterns

### Button

```
[ primary  ]   bg-papaya (gold)  text-papaya-foreground  px-6 py-3  uppercase tracking-[0.08em]  font-medium
[ ghost    ]   bg-transparent  text-foreground  border-border  hover:border-papaya  hover:text-papaya
[ link cta ]   inline-flex items-center gap-2  text-foreground  hover:text-papaya
               trailing "↗" icon (gold), 16x16
```

### Forecast card

```
┌─────────────────────────────────┐
│ OVERLINE                        │   overline token, gold
│ 1972 Ferrari Dino 246 GT        │   h3, ivory
│                                 │
│   $124,500            +12.4%    │   num-lg     num-md (gold)
│                                 │
│ ────────────────────────────    │   1px hairline divider
│ JDM · MODERN CLASSIC      ↗    │   meta token, gold arrow
└─────────────────────────────────┘

hover: border becomes gold, image scale(1.02) 400ms ease-out
```

### Filter chip

- Default: 1px border `--border`, ivory text
- Active: 1px border gold, gold text, subtle `--papaya/10` fill
- Hover: border `--border-strong`, text shifts to gold

---

## 8. Imagery

- Hero photos preferred over illustrations. Editorial framing.
- 16:9 or 21:9 aspect ratios for hero / list cards.
- Subtle vignette acceptable on hero only.
- Image attribution must remain visible at `meta` size in the bottom-right of any displayed photo.

---

## 9. What Changed From the McLaren System

| Token | McLaren | Maserati |
|---|---|---|
| `--background` | `#000000` | `#05070d` (indigo-black) |
| `--papaya` (accent) | `#ff8000` orange | `#b9975b` gold |
| `--foreground` | `#ffffff` | `#f4f1e9` ivory |
| Display weight | `700` | `300` / `500` |
| Display tracking | `-0.02em` | `0` |
| Overline tracking | `0.12em` | `0.18em` |
| Radius scale | `0/2/4px` | `0/1/2px` |
| Motion duration | `150ms ease-out` | `200ms ease-in-out` |
| Buy/Hold/Sell | Bright (`#00d563`) | Desaturated (`#4ab87a`) |

Variable names (`--papaya-*`) intentionally retained — utility classes across the codebase (`bg-papaya`, `text-papaya`, `hover:border-papaya`) keep working unchanged and now render in gold. This is a token-only refresh; no component logic moved.
