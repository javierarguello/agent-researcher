import { createTheme } from '@mantine/core';

/**
 * "Research control room" identity: a disciplined instrument panel, not a
 * marketing page. Primary is violet (the admin signature); status color is
 * reserved strictly for job/ledger state. Data (ids, money, timings) is set in
 * a tabular monospace so columns scan cleanly — the deliberate signature.
 */
export const theme = createTheme({
  primaryColor: 'violet',
  primaryShade: { light: 6, dark: 8 },
  defaultRadius: 'md',
  autoContrast: true,
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  headings: {
    fontWeight: '650',
    sizes: {
      h1: { fontSize: '1.9rem', lineHeight: '1.2' },
      h2: { fontSize: '1.4rem', lineHeight: '1.25' },
      h3: { fontSize: '1.15rem', lineHeight: '1.3' },
      h4: { fontSize: '1rem', lineHeight: '1.35' },
    },
  },
  components: {
    Table: { defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md' } },
    Card: { defaultProps: { withBorder: true, radius: 'md' } },
  },
});
