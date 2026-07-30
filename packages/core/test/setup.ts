/** Global test setup: reset the in-memory Firestore + provider overrides between tests. */
import { beforeEach } from 'vitest';
import { __resetDb } from './mocks/firestore.js';
import { __resetStorage } from './mocks/storage.js';
import { __clearProvidersForTests } from '../src/llm/models.js';

beforeEach(() => {
  __resetDb();
  __resetStorage();
  __clearProvidersForTests();
});
