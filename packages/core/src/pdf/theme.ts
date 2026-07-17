/**
 * PDF report theming. The HTML/layout of a report PDF is SHARED across every app
 * (see `report-html.ts`); only these tokens change per app, so a new app gets a
 * branded PDF by registering a `PdfTheme` here — no layout code to touch.
 */
export interface PdfTheme {
  /** Brand name printed on the cover + footer. */
  brand: string;
  /** Small mono tagline under the brand, e.g. "AI BUSINESS RESEARCH". */
  tagline: string;
  /** Short code prefix for the dossier id, e.g. "FBL" → "FBL-2026-…". */
  dossierPrefix: string;
  fonts: {
    /** Display/body family (loaded via `fontImport`). */
    body: string;
    /** Monospace family for labels/data. */
    mono: string;
    /** CSS @import URL that loads the families above (fetched at render time). */
    fontImport: string;
  };
  colors: {
    accent: string;
    onAccent: string;
    page: string;
    tint: string;
    ink: string;
    inkStrong: string;
    muted: string;
    border: string;
    borderStrong: string;
    positive: string;
    negative: string;
    warn: string;
    /** Bar/series palette for charts + projections. */
    series: string[];
  };
}

/** Florida Biz Labs — derived from samples/Florida Biz Labs Report.html. */
const FBIZLAB: PdfTheme = {
  brand: 'Florida Biz Labs',
  tagline: 'AI BUSINESS RESEARCH',
  dossierPrefix: 'FBL',
  fonts: {
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontImport: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap',
  },
  colors: {
    accent: '#e65100',
    onAccent: '#fbfaf8',
    page: '#fbfaf8',
    tint: '#f3f0ea',
    ink: '#3f3b37',
    inkStrong: '#2a2824',
    muted: '#6b6860',
    border: '#dcd8d0',
    borderStrong: '#c9c3b8',
    positive: '#3d8b5a',
    negative: '#c0392b',
    warn: '#a06a00',
    series: ['#e65100', '#3d8b5a', '#2563a8', '#a06a00', '#8a5cf0', '#0e8a8a'],
  },
};

/** Neutral fallback for apps that haven't registered a theme yet. */
const DEFAULT: PdfTheme = {
  ...FBIZLAB,
  brand: 'Research Dossier',
  tagline: 'AI RESEARCH',
  dossierPrefix: 'DOS',
  colors: {
    ...FBIZLAB.colors,
    accent: '#1f2933',
    tint: '#f2f2f0',
    series: ['#1f2933', '#3d8b5a', '#2563a8', '#a06a00', '#8a5cf0', '#0e8a8a'],
  },
};

const THEMES: Record<string, PdfTheme> = {
  fbizlab: FBIZLAB,
};

/** The PDF theme for an app, falling back to a neutral default. */
export function getPdfTheme(appId: string): PdfTheme {
  return THEMES[appId] ?? DEFAULT;
}
