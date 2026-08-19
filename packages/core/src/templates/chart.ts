import { z } from 'zod';

/**
 * A chart an agent emits as part of the report, for the client to render. The
 * agent supplies the title, type, category labels, and one or more numeric
 * series — all built from real figures already in the report (never invented).
 * Reusable across templates: any section schema can embed `chartSchema` (or an
 * array of it), and the client renders any value of this shape as a chart.
 *
 * **Every string bound is stated in its `.describe()`**, because the schema no
 * longer carries them to the decoder: `maxLength` is deliberately withheld from
 * Gemini (`gemini-vertex.ts`, round 8 R8-21 — a constrained decoder satisfies an
 * upper bound by STOPPING at it, and all five of these are buyer-visible chart
 * copy). Withholding it removed the only channel that told the model a bound
 * existed at all, and `unit` — the tightest, eight characters — had no description
 * either, so an over-long one cost a repair round or, twice over, the agent's whole
 * slice (round 9, R9-14). A description costs nothing and Zod still enforces every
 * one of them after the fact.
 */
export const chartSchema = z.object({
  type: z.enum(['bar', 'line', 'pie', 'area']),
  title: z.string().max(160).describe('Chart title, in the report language. At most 160 characters.'),
  description: z.string().max(500).optional().describe('One-line caption explaining what the chart shows. At most 500 characters — write a sentence that ends, not a paragraph that is cut.'),
  /** Category axis (x for bar/line/area; slice names for pie). Aligned with each series `data`. */
  labels: z.array(z.string().max(80).describe('One category label, at most 80 characters.')).min(1).max(40),
  /** One series for pie; one or more for bar/line/area. `data` is aligned to `labels`. */
  series: z
    .array(
      z.object({
        name: z.string().max(80).describe('Series name, at most 80 characters.'),
        data: z.array(z.number().nullable()),
      }),
    )
    .min(1)
    .max(6),
  /** Value unit hint for axis/tooltip formatting, e.g. '$', '%', 'x', 'yrs'. */
  unit: z.string().max(8).optional().describe('Value unit for axis and tooltip formatting, at most 8 characters — a symbol or a short abbreviation, e.g. "$", "%", "x", "yrs". Not a sentence.'),
  /** Stack the series (bar/area). */
  stacked: z.boolean().optional(),
});

export type ChartSpec = z.infer<typeof chartSchema>;
