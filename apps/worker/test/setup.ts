/** Reset the in-memory Firestore + Storage between worker tests. */
import { beforeEach } from 'vitest';
import { __resetDb } from '../../../packages/core/test/mocks/firestore.js';
import { __resetStorage } from '../../../packages/core/test/mocks/storage.js';
import { forbidPaidProviders } from '../../../packages/core/test/mocks/no-paid-calls.js';

beforeEach(() => {
  __resetDb();
  __resetStorage();
  forbidPaidProviders();
});
