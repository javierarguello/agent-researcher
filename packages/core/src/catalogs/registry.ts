/**
 * Every catalog a client may ask for, by id.
 *
 * A registry rather than a folder scan, for the same reason `TEMPLATES` is one: a
 * catalog that exists but is not registered is a `paramsUi.catalog` pointing at
 * nothing, and `validateTemplate` catches that at boot only if there is one list to
 * check against.
 */
import { floridaLocations } from './florida-locations.js';
import type { Catalog } from './types.js';

const CATALOGS: Catalog[] = [floridaLocations];

export function getCatalog(id: string): Catalog | undefined {
  return CATALOGS.find((c) => c.id === id);
}

/** Ids and labels only — a client picking one does not need 124 rows to do it. */
export function listCatalogs(): Array<{ id: string; label: string; items: number }> {
  return CATALOGS.map((c) => ({ id: c.id, label: c.label, items: c.items.length }));
}
