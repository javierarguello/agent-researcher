/**
 * A shared list of values a client can offer for a param — bigger than the handful
 * a template inlines in `paramsUi.fields[x].suggestions`, and reusable across
 * models.
 *
 * Catalogs are OFFERED, never enforced. A field that points at one stays whatever
 * its schema says it is — free text, usually — because the list is there to save
 * typing, not to decide what a buyer is allowed to want. The day one of these has
 * to be authoritative it belongs in the schema as an enum, not here.
 */
export interface CatalogItem {
  /** What goes into the param. Also the label, unless `label` says otherwise. */
  value: string;
  label?: string;
  /** Optional heading a client may group by (counties, cities, …). */
  group?: string;
}

export interface Catalog {
  id: string;
  label: string;
  items: CatalogItem[];
}
