/** Reset the in-memory Firestore + Storage between worker tests. */
import { beforeEach } from 'vitest';
import { __resetDb } from '../../../packages/core/test/mocks/firestore.js';
import { __resetStorage } from '../../../packages/core/test/mocks/storage.js';

beforeEach(() => {
  __resetDb();
  __resetStorage();
});
