# FloridaBizLab — Design System

The single source of truth for the fbizlab web app's look & feel. All tokens live
in `src/styles.css` as CSS variables and utility classes — **use them, don't
hard-code values.** (FL-INVEST was an earlier working name; the brand is
**FloridaBizLab**.)

## Voice & tone
Modern, sober, trustworthy — like a financial SaaS, not a marketplace or listings
portal.
- **Use:** market discovery, research dossier, AI analysis, signals, opportunities.
- **Avoid:** listings, search engine, replica, scraper.
- Personality: data-driven, forward-thinking, clear, confident, built for investors.

## Color (`:root` tokens)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#fbfaf8` | sand — page background |
| `--bg-alt` / `--bg-panel` | `#f5f0e8` / `#f0ebe1` | alternating section panels |
| `--ink` / `--ink-soft` | `#2a2824` / `#4a4740` | warm black text / body |
| `--muted` | `#6b6860` | labels, captions |
| `--accent` | `#e65100` | clay/coral — CTAs, kickers, key metrics |
| `--positive` | `#3d8b5a` | positive signals (ROI, "strong opportunity") |
| `--risk` | `#c0392b` | risk flags, errors |
| `--black` | `#23201b` | warm-black buttons |
| `--line` / `--card` | `#e5dfd4` / `#fff` | hairline borders / cards |

One accent only (coral). Green/red are reserved strictly for signal/risk state.

## Typography
- **Headings + body:** Inter (`--sans`, self-hosted via `@fontsource-variable/inter`).
- **Labels, prices, disclaimers, data:** JetBrains Mono (`--mono`).
- Scale: `.h-xl` (hero, 800, tracking-tight), `.h-lg` (section, 700), `.eyebrow`
  (10px mono uppercase, letter-spacing .22em, coral), `.lead` (body), buttons
  (mono, 11px, bold, uppercase, tracking-widest).

## Layout
- Max width **1440px** (`--maxw`), side padding `48px` (`24px` on mobile) — `.container`.
- Architectural grid: clean lines, delimited panels (`.section`, `--alt`/`--panel`),
  lots of air. Sharp corners (`--radius: 2px`), hairline `1px` borders.

## Components
- **Buttons** `.btn`: `--black` primary (hover → coral), `--outline` secondary
  (hover inverts to black), `--accent` for the strongest CTA. `.btn--sm`, `.btn--block`.
- **Cards** `.card`: white, hairline border. Structure = kicker (`.eyebrow`) → title
  → metrics.
- **Metrics** `.kv`: mono label / big value (coral or green) / mono confidence sub.
  Signals: `.sig.sig--ok` (green outline), `.sig.sig--risk` (red outline).
- **Forms** `.field` + `.input`/`.select`/`.textarea`: clean, hairline border,
  muted placeholder, coral focus ring.
- **Tables** `.tbl`, **status badges** `.badge.{running,completed,failed,…}`,
  **report prose** `.prose`, **accordion** `.acc-*`.
- **Icons:** thin stroked line icons (`src/components/icons.tsx`), 1.4–1.5 stroke.

## Motion
- Entrance: `slideUp` 600ms `cubic-bezier(0.16,1,0.3,1)` (`.rise`), staggered with
  `.rise-1`/`.rise-2` (150/300ms). Hover = smooth color transitions only.
- `prefers-reduced-motion` disables all animation.

## Internationalization (required)
**The app is fully localized to every language the API supports: `en, es, fr, pt`**
(`LANGS` in `src/i18n.tsx` — must stay in sync with the API's `SUPPORTED_LANGS`).
- UI copy lives in per-file dictionaries keyed by language; read it with
  `pick(dict, lang)` (English fallback). Every user-facing string must have all
  four translations — no hard-coded English in components.
- The language switcher (`LangSwitcher`) covers all languages and persists the
  choice; the chosen `lang` is also passed to the API (`GET /templates?lang=`,
  etc.) so **model/report texts come back localized too**, and sets
  `<html lang>`.
- When adding a new supported language: add it to `LANGS` + `LANG_LABELS`, and add
  its entry to every copy dictionary.

## SEO
- Static meta in `index.html`: title, description, canonical, Open Graph (+
  `og:locale:alternate` for es/fr/pt), Twitter card, JSON-LD `WebApplication`,
  favicon. `public/robots.txt` + `public/sitemap.xml`.
- Only the public landing (`/`) is indexable; `/app` and `/login` are set to
  `noindex` at runtime (see `App.tsx`).
