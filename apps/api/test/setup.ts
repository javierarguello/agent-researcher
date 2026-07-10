/** Reset the in-memory Firestore between API tests. */
import { beforeEach } from 'vitest';
import { __resetDb } from '../../../packages/core/test/mocks/firestore.js';

beforeEach(() => __resetDb());
