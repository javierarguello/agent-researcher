/**
 * Where in Florida a buyer can point a search.
 *
 * Static, and it should be: Florida's counties are a fixed set of 67 that changed
 * last in 1925, and the cities below are the largest by population. Fetching this
 * from somewhere would buy nothing and add a dependency that can be down while a
 * buyer is filling in a form.
 *
 * It is a SUGGESTION list, never a validation: `location` stays free text, because
 * a buyer who wants "the I-4 corridor" or "Broward, north of Sunrise Blvd" is
 * describing something real that no list contains. What the catalog buys is the
 * ordinary case — typing three letters instead of a county name nobody spells the
 * same way twice.
 */
import type { Catalog } from './types.js';

/** The 67, alphabetically. A test asserts the count, because that is the fact. */
const COUNTIES = [
  'Alachua', 'Baker', 'Bay', 'Bradford', 'Brevard', 'Broward', 'Calhoun', 'Charlotte',
  'Citrus', 'Clay', 'Collier', 'Columbia', 'DeSoto', 'Dixie', 'Duval', 'Escambia',
  'Flagler', 'Franklin', 'Gadsden', 'Gilchrist', 'Glades', 'Gulf', 'Hamilton', 'Hardee',
  'Hendry', 'Hernando', 'Highlands', 'Hillsborough', 'Holmes', 'Indian River', 'Jackson',
  'Jefferson', 'Lafayette', 'Lake', 'Lee', 'Leon', 'Levy', 'Liberty', 'Madison', 'Manatee',
  'Marion', 'Martin', 'Miami-Dade', 'Monroe', 'Nassau', 'Okaloosa', 'Okeechobee', 'Orange',
  'Osceola', 'Palm Beach', 'Pasco', 'Pinellas', 'Polk', 'Putnam', 'St. Johns', 'St. Lucie',
  'Santa Rosa', 'Sarasota', 'Seminole', 'Sumter', 'Suwannee', 'Taylor', 'Union', 'Volusia',
  'Wakulla', 'Walton', 'Washington',
];

/** The larger cities, because "Hialeah" is how a buyer thinks, not "Miami-Dade". */
const CITIES = [
  'Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Port St. Lucie',
  'Cape Coral', 'Tallahassee', 'Fort Lauderdale', 'Pembroke Pines', 'Hollywood', 'Gainesville',
  'Miramar', 'Coral Springs', 'Palm Bay', 'West Palm Beach', 'Lakeland', 'Clearwater',
  'Pompano Beach', 'Miami Gardens', 'Spring Hill', 'Davie', 'Brandon', 'Boca Raton',
  'Sunrise', 'Deltona', 'Riverview', 'Plantation', 'Fort Myers', 'Palm Coast', 'Largo',
  'Deerfield Beach', 'Melbourne', 'Boynton Beach', 'Lauderhill', 'Kissimmee', 'Weston',
  'Homestead', 'Delray Beach', 'Daytona Beach', 'Ocala', 'Port Orange', 'Sanford',
  'Wellington', 'Jupiter', 'Sarasota', 'Naples', 'Bradenton', 'Pensacola', 'Coral Gables',
  'Doral', 'Aventura', 'Kendall', 'The Villages', 'Winter Haven', 'Bonita Springs',
];

export const floridaLocations: Catalog = {
  id: 'florida-locations',
  label: 'Florida — counties and cities',
  // The whole state first: it is the model's own default, and a buyer who does not
  // want to narrow should not have to scroll 124 rows to find that out.
  items: [
    { value: 'State of Florida, USA', group: 'Statewide' },
    ...COUNTIES.map((c) => ({ value: `${c} County, FL`, group: 'Counties' })),
    ...CITIES.map((c) => ({ value: `${c}, FL`, group: 'Cities' })),
  ],
};
