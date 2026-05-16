# CarClubFuture Design System

Inspired by **mclaren.com/racing** (Nov 2026 capture). McLaren's proprietary assets (the `mclStandard` typeface family and the Speedmark logo) are not redistributable, so this system substitutes open-source equivalents that capture the same geometric, motorsport-inflected feel while staying legally clean.

---

## 1. Brand Voice

| Attribute | Direction |
|---|---|
| Tone | Editorial, confident, motorsport-adjacent. Headlines shout, body whispers. |
| Density | High contrast: large hero blocks → tight data cards. |
| Color discipline | Pure black canvas. One signal color (papaya). Status colors only where data demands. |
| Geometry | Sharp. No `rounded-2xl`. 0–4px corners only. |
| Motion | Restrained. 150ms ease-out. No bounce. |

---

## 2. Color Tokens

McLaren uses pure black canvas with a single brand accent (papaya orange) and neutral grays. We retain CarClubFuture's existing semantic colors (buy/hold/sell) because they carry real meaning the McLaren site doesn't need.

```css
:root {
  /* Canvas */
  --background:        #000000;   /* pure black, was #0a0a0b */
  --surface:           #0a0a0a;   /* one step up from canvas */
  --surface-elevated:  #141414;   /* cards */
  --surface-overlay:   #1f1f1f;   /* hover, modal */

  /* Ink */
  --foreground:        #ffffff;   /* primary text */
  --foreground-muted:  #c4c4c4;   /* secondary text — McLaren's exact gray */
  --foreground-dim:    #6b6b6b;   /* tertiary / meta */

  /* Borders & dividers */
  --border:            #2a2a2a;
  --border-strong:     #3f3f3f;

  /* Brand */
  --papaya:            #ff8000;   /* McLaren primary — exact match */
  --papaya-hover:      #ff9933;
  --papaya-press:      #cc6600;
  --papaya-foreground: #000000;   /* text on papaya */

  /* Semantic (kept from existing system, retuned for black canvas) */
  --buy:               #00d563;   /* slightly brighter for contrast on black */
  --hold:              #ffb800;
  --sell:              #ff3b3b;
  --confidence-high:   var(--buy);
  --confidence-medium: var(--hold);
  --confidence-low:    var(--sell);
}
```

**Usage rules**
- Papaya is reserved for: primary CTAs, active filter chips, hover/focus rings, the brand wordmark accent, and key data highlights (e.g., 12-mo CAGR badge).
- Never use papaya for body copy or large surfaces. It is a punctuation color.
- Buy/Hold/Sell pills retain their meaning — they are not decorative.

---

## 3. Typography

McLaren ships proprietary `mclStandardRegular` / `mclStandardLight`. We cannot use these. The closest open-source pairing that preserves the same wide-set geometric display + clean humanist body:

| Role | Family | Source | Weights |
|---|---|---|---|
| Display (H1–H2, hero, all-caps overlines) | **Space Grotesk** | next/font/google | 500, 700 |
| Body & UI | **Inter** | next/font/google | 400, 500, 600 |
| Numeric (prices, CAGR, mileage) | **JetBrains Mono** | next/font/google | 400, 500 — tabular figures |

**Scale (rem-based, 16px root)**

| Token | Size / line-height | Weight | Tracking | Case | Use |
|---|---|---|---|---|---|
| `display-2xl` | 5.5rem / 1.0 | 700 | -0.02em | UPPER | Home hero headline only |
| `display-xl`  | 4rem / 1.05  | 700 | -0.02em | UPPER | Section openers ("CATALOG", "FORECAST") |
| `display-lg`  | 2.75rem / 1.1| 700 | -0.01em | UPPER | Page titles |
| `h1`          | 2rem / 1.15  | 700 | -0.01em | sentence | Card cluster heads |
| `h2`          | 1.5rem / 1.2 | 600 | 0       | sentence | Sub-sections |
| `h3`          | 1.125rem / 1.3 | 600 | 0     | sentence | Card titles |
| `overline`    | 0.75rem / 1.3 | 600 | 0.12em | UPPER | Eyebrow labels above headings |
| `body`        | 1rem / 1.55  | 400 | 0       | sentence | Default copy |
| `body-sm`     | 0.875rem / 1.5 | 400 | 0     | sentence | Card body, captions |
| `meta`        | 0.75rem / 1.4 | 500 | 0.04em | UPPER | Timestamps, source pills |
| `num-lg`      | 2rem / 1.0 (mono) | 500 | 0    | — | Hero figures (price) |
| `num-md`      | 1.25rem / 1.0 (mono) | 500 | 0  | — | Card figures (CAGR) |

All-caps display headings are McLaren's defining signature. Use them ruthlessly for section headers, but never for body or links.

---

## 4. Spacing & Layout

```
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 px
```

- Content max-width: `1440px` (was `1280px`) — McLaren leans wide.
- Section vertical rhythm: `96px` desktop, `48px` mobile.
- Card grid gap: `24px` desktop, `16px` mobile.
- Page gutters: `clamp(16px, 4vw, 48px)`.

---

## 5. Radius & Borders

McLaren cards are nearly square. Sharp geometry is the whole point.

| Token | Value | Use |
|---|---|---|
| `radius-none` | 0 | Hero cards, primary buttons |
| `radius-sm` | 2px | Default — all cards, inputs, chips |
| `radius-md` | 4px | Only for elements that must feel pillowy (avatar, kebab menus) |

Borders are 1px `--border` by default; bump to `--border-strong` on hover. **No glow/shadow elevations.** Elevation is communicated by surface color step, not by shadow.

---

## 6. Component Patterns

### 6.1 Button

```
[ primary  ]   bg-papaya  text-black  px-6 py-3  uppercase tracking-[0.04em]  font-semibold
[ ghost    ]   bg-transparent  text-white  border-border  hover:border-papaya  hover:text-papaya
[ link cta ]   inline-flex items-center gap-2  text-white  hover:text-papaya
               trailing "↗" icon (papaya), 16x16
```

The "arrow top right" (↗) is McLaren's universal "more" affordance. Apply it to every navigable card and outbound link.

### 6.2 Card — "Image Tile" (catalog, hero promo)

```
┌─────────────────────────────┐
│                             │
│       full-bleed image      │   16:9 default; image fills, no padding
│                             │
├─────────────────────────────┤
│ OVERLINE                    │   meta token, papaya
│ ## TITLE                    │   h3, white
│ supporting copy             │   body-sm, foreground-muted
│                          ↗  │   papaya arrow, bottom-right
└─────────────────────────────┘

bg: surface-elevated   border: 1px border
hover: border-papaya, image scale(1.02) 300ms ease-out
```

### 6.3 Card — "Data Card" (forecast card)

```
┌────────────────────────────────────────────┐
│ [thumb 96x72]   YEAR MAKE MODEL            │
│                 trim · era                 │
│                                            │
│   $124,500            +12.4%               │   num-lg     num-md (papaya)
│   median price        12-mo CAGR           │   meta       meta
│                                            │
│   [BUY pill]  [confidence: HIGH]        ↗ │
└────────────────────────────────────────────┘

bg: surface-elevated   border: 1px border   radius: sm
hover: border-papaya
```

### 6.4 Filter Chip

```
inactive:  bg-surface  border-border  text-foreground-muted  px-4 py-2  uppercase meta token  radius-sm
hover:     border-strong
active:    bg-papaya text-black  border-papaya
disabled:  opacity-40, no border change
```

Counts render in a tabular num right of the label: `JAPANESE ICONS  2175`.

### 6.5 Navigation (top bar)

- Solid black, 72px tall, sticks to top.
- Left: wordmark "CARCLUBFUTURE" in display-lg, 700, tracking-tight, white. The "FUTURE" half is papaya.
- Right: links in `meta` token, UPPER, white → papaya on hover. Active link gets a 2px papaya underline.
- No background blur, no translucency. Pure black.

### 6.6 Hero (home page)

- Full-viewport-height (clamp 600–900px) section.
- Full-bleed background image (a curated catalog vehicle, randomized daily from a vetted list).
- Bottom-left content block: overline → display-2xl headline → 1-sentence subhead → primary button.
- Gradient `linear-gradient(to top, #000 0%, transparent 60%)` over the image for legibility.

### 6.7 Section Header

```
─────────────────────────────────────
OVERLINE                              (meta, papaya)
DISPLAY HEADLINE                      (display-xl, white, uppercase)
optional 1-line subhead               (body, foreground-muted)
─────────────────────────────────────
```

The top rule is a 1px `--border-strong` line spanning the content column. McLaren uses this constantly.

---

## 7. Iconography

- Single icon family: **Lucide** (already common in Next.js projects). 1.5px stroke. Currentcolor.
- The "arrow top right" CTA icon is `lucide:arrow-up-right`, always 16×16, always papaya on hover/active card states.
- No emoji in UI chrome. Emoji acceptable only in user-generated text (none on this site today).

---

## 8. Imagery

- Black-and-white treatment is **off** by default — collector cars need their color. McLaren's monochrome look does not transfer here.
- All catalog thumbnails crop to 16:9 (`object-cover`).
- Attribution line (Wikimedia author + license) renders in `meta` token, `foreground-dim`, below the image on detail pages. Already required by Wikimedia license — non-negotiable.
- Cars-without-images keep the existing generic SVG fallback. Do not invent imagery.

---

## 9. Motion

- All hover transitions: `150ms ease-out` for color/border; `300ms ease-out` for image transforms.
- No page transitions, no scroll-jacking, no parallax. McLaren uses these — we won't, because they hurt forecast-data scanability.
- Reduced-motion: respect `prefers-reduced-motion: reduce` — drop all transforms, keep color transitions at `0ms`.

---

## 10. Mapping to Existing CarClubFuture Files

| Current file | Change |
|---|---|
| `src/app/globals.css` | Replace `:root` color tokens with §2; add font CSS vars |
| `src/app/layout.tsx` | Wire `Space_Grotesk`, `Inter`, `JetBrains_Mono` via `next/font/google`; expose via CSS vars |
| `tailwind.config.*` (or `@theme inline` block in globals.css — project uses Tailwind v4) | Add `display-*`, `overline`, `meta`, `num-*` font-size tokens; add `papaya` color tokens |
| `src/components/ui/button.tsx` (if exists) | Add `primary` / `ghost` / `link-cta` variants per §6.1 |
| `src/components/cars/car-forecast-card.tsx` | Restyle per §6.3; replace rounded corners with `rounded-sm`; add ↗ icon |
| `src/components/cars/forecast-dashboard.tsx` | Restyle filter chips per §6.4; add overline + section header per §6.7 |
| `src/components/layout/*` | Restyle nav per §6.5 |
| `src/app/page.tsx` | New hero per §6.6 (image picker: top-N most-recently-mirrored vehicles with `imageStatus:"ok"`) |
| `src/app/car-forecast/[slug]/page.tsx` | Apply section headers; convert info cards to data card pattern |

---

## 11. What This Design Explicitly Does NOT Take From McLaren

To stay legally and ethically clean:

- **No McLaren logo / Speedmark** — we have our own wordmark.
- **No `mclStandard` font files** — proprietary; we use Space Grotesk + Inter + JetBrains Mono.
- **No McLaren imagery** — all hero/card images come from our existing Wikimedia-licensed catalog.
- **No team/driver references** — this is a car investment site, not a racing site.
- **No "MCL", "Papaya Rules", or McLaren-trademarked phrases** in copy.

What we DO take is purely visual language that is not protectable: black canvas, single signal color (any orange-family hue would work — papaya is the strongest motorsport reference), all-caps geometric headlines, sharp corners, ↗ arrow CTA convention, and the section-rule + overline pattern.

---

## 12. Open Questions

- Should the existing amber accent (`#f59e0b`) be fully removed from the codebase, or kept as a fallback for any place we miss in this pass? **Recommendation:** fully remove — half-replacement looks like a bug.
- Should we keep buy/hold/sell green/yellow/red, or compress to white/papaya/sell-only? **Recommendation:** keep — semantic loss isn't worth the visual purity.
- Does anything on McLaren's site that we like need a license we don't have (e.g., the Speedmark animation)? **Confirmed:** No — we are not copying any McLaren-trademarked or copyrighted asset.
