/** Global test setup: reset the in-memory Firestore + provider overrides between tests. */
import { beforeEach } from 'vitest';
import { __resetDb } from './mocks/firestore.js';
import { __resetStorage } from './mocks/storage.js';
import { __clearProvidersForTests } from '../src/llm/models.js';
import { forbidPaidProviders } from './mocks/no-paid-calls.js';

beforeEach(() => {
  __resetDb();
  __resetStorage();
  __clearProvidersForTests();
  // Last, so it survives the reset: a test that forgets its stub fails loudly
  // instead of billing a live model.
  forbidPaidProviders();
});
