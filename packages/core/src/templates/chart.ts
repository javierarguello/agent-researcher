import { z } from 'zod';

/**
 * A chart an agent emits as part of the report, for the client to render. The
 * agent supplies the title, type, category labels, and one or more numeric
 * series — all built from real figures already in the report (never invented).
 * Reusable across templates: any section schema can embed `chartSchema` (or an
 * array of it), and the client renders any value of this shape as a chart.
 */
export const chartSchema = z.object({
  type: z.enum(['bar', 'line', 'pie', 'area']),
  title: z.string().max(160).describe('Chart title, in the report language.'),
  description: z.string().max(500).optional().describe('One-line caption explaining what the chart shows.'),
  /** Category axis (x for bar/line/area; slice names for pie). Aligned with each series `data`. */
  labels: z.array(z.string().max(80)).min(1).max(40),
  /** One series for pie; one or more for bar/line/area. `data` is aligned to `labels`. */
  series: z
    .array(
      z.object({
        name: z.string().max(80),
        data: z.array(z.number().nullable()),
      }),
    )
    .min(1)
    .max(6),
  /** Value unit hint for axis/tooltip formatting, e.g. '$', '%', 'x', 'yrs'. */
  unit: z.string().max(8).optional(),
  /** Stack the series (bar/area). */
  stacked: z.boolean().optional(),
});

export type ChartSpec = z.infer<typeof chartSchema>;
