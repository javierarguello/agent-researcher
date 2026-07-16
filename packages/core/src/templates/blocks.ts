/**
 * Reusable STRUCTURED report primitives — so models emit numbers, projections and
 * prioritised risks as JSON (not buried in Markdown), and any web front can render
 * them as badges, tables, charts and colour-coded lists for quick review. Every
 * research template can compose these into its sections.
 */
import { z } from 'zod';

const md = (w: string) => `${w} (Markdown).`;

/**
 * A headline number the front shows as a badge/tile — the model pre-picks the
 * important figures for a section instead of leaving them inside prose.
 */
export const metricSchema = z.object({
  label: z.string().describe('Short label, e.g. "Est. annual revenue", "Avg weekly ticket".'),
  value: z.string().describe('Formatted value WITH units, e.g. "$1.15M–$1.28M", "+4.2%", "10–12 mo", "75k+".'),
  emphasis: z.enum(['positive', 'negative', 'neutral']).default('neutral').describe('Colour hint for the value (green/red/plain).'),
  hint: z.string().nullable().describe('Optional sub-note, e.g. "80% confidence"; null if none.'),
});
export type Metric = z.infer<typeof metricSchema>;

/** A prioritised risk so the front can colour-code by severity. */
export const riskItemSchema = z.object({
  severity: z.enum(['high', 'medium', 'low']).describe('Priority: high=red, medium=amber, low=muted.'),
  title: z.string().describe('Short risk name (a few words).'),
  detail: z.string().describe(md('What the risk is, why it matters, and how to verify/mitigate it')),
});
export type RiskItem = z.infer<typeof riskItemSchema>;

/**
 * A numeric projection/estimate table (Year 1 / Year 2 / …) → rendered as a table
 * AND a chart. Each row is one metric measured across the shared periods.
 */
export const projectionTableSchema = z.object({
  periods: z.array(z.string()).min(2).describe('Ordered column headers, e.g. ["Year 1","Year 2","Year 3"].'),
  rows: z
    .array(
      z.object({
        metric: z.string().describe('Row label, e.g. "Revenue", "SDE", "Debt service".'),
        unit: z.enum(['$', '%', 'x', '#']).default('$').describe('Unit applied to every value in the row.'),
        values: z.array(z.number().nullable()).describe('One number per period, in order (null if unknown).'),
      }),
    )
    .min(1),
  note: z.string().nullable().describe('Optional assumptions/caveat line; null if none.'),
});
export type ProjectionTable = z.infer<typeof projectionTableSchema>;
