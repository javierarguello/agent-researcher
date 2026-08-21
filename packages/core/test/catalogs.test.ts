/**
 * The shared value lists a param can point at.
 *
 * Static, and it should be: Florida's counties are a fixed set of 67 that last
 * changed in 1925. Fetching them from somewhere would buy nothing and add a
 * dependency that can be down while a buyer is filling in a form.
 *
 * OFFERED, never enforced — `location` stays free text. A buyer who wants "the I-4
 * corridor" or "Broward, north of Sunrise Blvd" is describing something real that
 * no list contains, and a catalog that started refusing those would be a schema
 * enum pretending to be a convenience.
 */
import { describe, it, expect } from 'vitest';
import { getCatalog, listCatalogs } from '../src/catalogs/registry.js';
import { validateRequest } from '../src/index.js';
import { floridaBusinessForSale as tpl } from '../src/templates/florida-business-for-sale.js';
import { validateTemplate } from '../src/templates/validate.js';
import { toManifest } from '../src/templates/registry.js';

describe('the Florida locations catalog', () => {
  it('has all 67 counties — the number IS the fact', () => {
    // Asserted as a count because that is what makes it checkable: a list of names
    // nobody counts is a list with Sumter missing and nothing to say so.
    const counties = getCatalog('florida-locations')!.items.filter((i) => i.group === 'Counties');
    expect(counties).toHaveLength(67);
    // No duplicates, which is the other way a hand-written list of 67 goes wrong.
    expect(new Set(counties.map((c) => c.value)).size).toBe(67);
    // Spot-checked at both ends of the alphabet and in the middle.
    for (const c of ['Alachua County, FL', 'Miami-Dade County, FL', 'Sumter County, FL', 'Washington County, FL']) {
      expect(counties.map((x) => x.value), c).toContain(c);
    }
  });

  it('offers the statewide default first', () => {
    // It is the model's own default for `location`. A buyer who does not want to
    // narrow should not scroll 124 rows to discover that is allowed.
    const items = getCatalog('florida-locations')!.items;
    expect(items[0]!.value).toBe('State of Florida, USA');
    expect(items[0]!.value).toBe(tpl.paramsSchema.parse({ industry: 'x' }).location);
  });

  it('names cities the way a buyer thinks of them', () => {
    const cities = getCatalog('florida-locations')!.items.filter((i) => i.group === 'Cities').map((c) => c.value);
    // "Hialeah" is how someone searches; "Miami-Dade" is how a county is filed.
    for (const c of ['Hialeah, FL', 'St. Petersburg, FL', 'The Villages, FL']) expect(cities).toContain(c);
  });

  it('lists itself without its contents', () => {
    const listed = listCatalogs();
    expect(listed).toEqual([{ id: 'florida-locations', label: expect.any(String), items: expect.any(Number) }]);
    expect(listed[0]!.items).toBe(getCatalog('florida-locations')!.items.length);
  });
});

describe('a field that points at one', () => {
  it('reaches the client through the manifest', () => {
    // The whole point of putting the hint in `paramsUi`: no client hardcodes which
    // field has a list, and a second model gets the same behaviour for free.
    expect(toManifest(tpl).paramsUi!.fields!.location!.catalog).toBe('florida-locations');
  });

  it('does not narrow the param — it is a suggestion', () => {
    // The property that keeps this a convenience: a value nobody listed goes through.
    const out = validateRequest({
      template: 'florida-business-for-sale',
      params: { industry: 'laundromats', location: 'the I-4 corridor between Tampa and Orlando' },
    });
    expect(out.params.location).toBe('the I-4 corridor between Tampa and Orlando');
  });

  it('fails the boot when it points at nothing', () => {
    // A hint naming a catalog that does not exist renders as a field with no
    // autocomplete and no error — the kind of thing nobody notices until someone
    // asks why the list stopped appearing.
    const broken = {
      ...tpl,
      paramsUi: { ...tpl.paramsUi, fields: { ...tpl.paramsUi!.fields, location: { catalog: 'florida-lockations' } } },
    } as typeof tpl;
    expect(validateTemplate(broken).join(' ')).toContain('unknown catalog "florida-lockations"');
    expect(validateTemplate(tpl), 'the real template stopped being valid').toEqual([]);
  });
});
