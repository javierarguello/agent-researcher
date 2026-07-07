import { z } from 'zod';
import { floridaBusinessForSale } from './florida-business-for-sale.js';
import { reportSchemaOf, type ResearchTemplate, type TemplateManifest } from './types.js';
import { assertTemplatesValid } from './validate.js';

/** All research templates ("models") the API supports. Add new verticals here. */
const TEMPLATES: Record<string, ResearchTemplate<any>> = {
  [floridaBusinessForSale.id]: floridaBusinessForSale,
};

// Fail fast at load time if any template is malformed (bad agent/section/model ref).
assertTemplatesValid(Object.values(TEMPLATES));

export function getTemplate(id: string): ResearchTemplate<any> | undefined {
  return TEMPLATES[id];
}

export function listTemplates(): ResearchTemplate<any>[] {
  return Object.values(TEMPLATES);
}

/** Public, client-safe manifest (never exposes the internal base prompt). */
export function toManifest(t: ResearchTemplate<any>): TemplateManifest {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    sections: t.sections.map((s) => ({ key: s.key, title: s.title })),
    paramsSchema: z.toJSONSchema(t.paramsSchema),
    reportSchema: z.toJSONSchema(reportSchemaOf(t)),
  };
}

export { TEMPLATES };
