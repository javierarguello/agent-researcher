/**
 * In-memory Firestore fake for unit tests. Implements exactly the surface the
 * stores use: nested collections/docs, get/set(merge) with FieldValue, queries
 * (where/orderBy/limit), transactions, batch, collectionGroup, FieldValue and
 * Timestamp. No network, no emulator.
 *
 * Wire it up with:
 *   vi.mock('@google-cloud/firestore', () => import('../mocks/firestore.js'));
 * and reset between tests with `__resetDb()`.
 */

// --- sentinels --------------------------------------------------------------

class FieldSentinel {
  constructor(
    readonly op: 'increment' | 'delete',
    readonly n = 0,
  ) {}
}
export const FieldValue = {
  increment: (n: number) => new FieldSentinel('increment', n),
  delete: () => new FieldSentinel('delete'),
};

export const Timestamp = {
  fromMillis: (ms: number) => ({ _ms: ms, toMillis: () => ms, toDate: () => new Date(ms) }),
  fromDate: (d: Date) => ({ _ms: d.getTime(), toMillis: () => d.getTime(), toDate: () => d }),
};

// --- shared store -----------------------------------------------------------

const DB = new Map<string, Record<string, unknown>>(); // docPath -> data
export function __resetDb(): void {
  DB.clear();
}
export function __dump(): Map<string, Record<string, unknown>> {
  return new Map(DB);
}

const DELETE = Symbol('delete');

function mergeValue(existing: unknown, incoming: unknown): unknown {
  if (incoming instanceof FieldSentinel) {
    if (incoming.op === 'delete') return DELETE;
    return (typeof existing === 'number' ? existing : 0) + incoming.n;
  }
  if (isPlainObject(incoming) && isPlainObject(existing)) {
    const out: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      const merged = mergeValue(out[k], v);
      if (merged === DELETE) delete out[k];
      else out[k] = merged;
    }
    return out;
  }
  if (isPlainObject(incoming)) {
    // increments inside a fresh nested object start from 0
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(incoming)) {
      const merged = mergeValue(undefined, v);
      if (merged !== DELETE) out[k] = merged;
    }
    return out;
  }
  return incoming;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof FieldSentinel) && !(v as any)._ms;
}

function parentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
function collectionId(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2] ?? '';
}

// --- references -------------------------------------------------------------

class DocumentSnapshot {
  constructor(
    readonly ref: DocumentReference,
    private readonly _data: Record<string, unknown> | undefined,
  ) {}
  get exists(): boolean {
    return this._data !== undefined;
  }
  data(): Record<string, unknown> | undefined {
    return this._data;
  }
  get id(): string {
    return this.ref.id;
  }
}

class DocumentReference {
  constructor(readonly path: string) {}
  get id(): string {
    return this.path.split('/').pop()!;
  }
  collection(name: string): CollectionReference {
    return new CollectionReference(`${this.path}/${name}`);
  }
  async get(): Promise<DocumentSnapshot> {
    const d = DB.get(this.path);
    return new DocumentSnapshot(this, d ? { ...d } : undefined);
  }
  async set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
    if (opts?.merge) {
      const existing = DB.get(this.path) ?? {};
      const merged = mergeValue(existing, data) as Record<string, unknown>;
      DB.set(this.path, merged);
    } else {
      const clean = mergeValue(undefined, data) as Record<string, unknown>;
      DB.set(this.path, clean);
    }
  }
  async delete(): Promise<void> {
    DB.delete(this.path);
  }
}

interface Filter {
  field: string;
  op: string;
  value: unknown;
}

class Query {
  constructor(
    protected readonly path: string,
    protected readonly filters: Filter[] = [],
    protected readonly order?: { field: string; dir: 'asc' | 'desc' },
    protected readonly max?: number,
    protected readonly group = false,
  ) {}
  where(field: string, op: string, value: unknown): Query {
    return new Query(this.path, [...this.filters, { field, op, value }], this.order, this.max, this.group);
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Query {
    return new Query(this.path, this.filters, { field, dir }, this.max, this.group);
  }
  limit(n: number): Query {
    return new Query(this.path, this.filters, this.order, n, this.group);
  }
  async get(): Promise<{ docs: DocumentSnapshot[]; empty: boolean; size: number }> {
    let entries = [...DB.entries()].filter(([p]) => (this.group ? collectionId(p) === this.path : parentPath(p) === this.path));
    for (const f of this.filters) {
      entries = entries.filter(([, d]) => match(d[f.field], f.op, f.value));
    }
    if (this.order) {
      const { field, dir } = this.order;
      entries.sort(([, a], [, b]) => cmp(a[field], b[field]) * (dir === 'desc' ? -1 : 1));
    }
    if (this.max != null) entries = entries.slice(0, this.max);
    const docs = entries.map(([p, d]) => new DocumentSnapshot(new DocumentReference(p), { ...d }));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

function match(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return cmp(a, b) > 0;
    case '>=':
      return cmp(a, b) >= 0;
    case '<':
      return cmp(a, b) < 0;
    case '<=':
      return cmp(a, b) <= 0;
    default:
      return false;
  }
}
function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  return (a as any) < (b as any) ? -1 : 1;
}

class CollectionReference extends Query {
  constructor(path: string) {
    super(path);
  }
  doc(id?: string): DocumentReference {
    return new DocumentReference(`${this.path}/${id ?? `auto_${DB.size}_${Math.floor(performance.now() * 1000)}`}`);
  }
}

class WriteBatch {
  private ops: (() => Promise<void>)[] = [];
  set(ref: DocumentReference, data: Record<string, unknown>, opts?: { merge?: boolean }): WriteBatch {
    this.ops.push(() => ref.set(data, opts));
    return this;
  }
  delete(ref: DocumentReference): WriteBatch {
    this.ops.push(() => ref.delete());
    return this;
  }
  async commit(): Promise<void> {
    for (const op of this.ops) await op();
  }
}

export class Firestore {
  constructor(_opts?: unknown) {}
  collection(name: string): CollectionReference {
    return new CollectionReference(name);
  }
  collectionGroup(name: string): Query {
    return new Query(name, [], undefined, undefined, true);
  }
  batch(): WriteBatch {
    return new WriteBatch();
  }
  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return fn(new Transaction());
  }
}

class Transaction {
  get(ref: DocumentReference): Promise<DocumentSnapshot> {
    return ref.get();
  }
  getAll(...refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
    return Promise.all(refs.map((r) => r.get()));
  }
  set(ref: DocumentReference, data: Record<string, unknown>, opts?: { merge?: boolean }): Transaction {
    void ref.set(data, opts);
    return this;
  }
  delete(ref: DocumentReference): Transaction {
    void ref.delete();
    return this;
  }
}
