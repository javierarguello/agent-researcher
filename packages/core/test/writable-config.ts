/**
 * A writable view of the config, for tests that need a different value.
 *
 * `config` is deeply readonly on purpose — nothing in `src/` may reassign it at
 * runtime. Tests legitimately do (a lower cost ceiling, a missing API key), and
 * before the suites were typechecked those assignments simply went unseen. This
 * names the exception instead of scattering casts, so the readonly contract still
 * holds everywhere it is not spelled out.
 */
// From `../src`, not the package entry: the tests import the module directly, and
// the two are separate instances — writing through the wrong one silently does
// nothing to the value the code under test reads.
import { config } from '../src/config.js';

// Recurses into objects only — mapping over a primitive mangles it.
type Writable<T> = T extends object ? { -readonly [K in keyof T]: Writable<T[K]> } : T;

export const writableConfig = config as Writable<typeof config>;
