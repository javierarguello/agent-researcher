/**
 * In-memory stand-in for `@google-cloud/storage`, aliased in the vitest configs
 * exactly like the Firestore fake.
 *
 * It exists because the alternative is worse than slow: without it, any test that
 * runs a job uploads `report.json` to the REAL dev bucket using whatever
 * credentials the developer happens to have. That is a test suite writing to
 * production-adjacent storage, and on a machine with no credentials it is a
 * multi-second network failure per call instead.
 *
 * Stateful on purpose: the checkpoint written by one dispatch is what the next one
 * resumes from, so a stub that forgets makes a resumed job look like a job that
 * simply ran again.
 */

/** path → contents. Exported so a test can inspect or seed what was stored. */
export const OBJECTS = new Map<string, Buffer>();

export function __resetStorage(): void {
  OBJECTS.clear();
}

class FakeFile {
  constructor(private readonly path: string) {}

  async save(body: string | Buffer): Promise<void> {
    OBJECTS.set(this.path, Buffer.isBuffer(body) ? body : Buffer.from(body));
  }

  async download(): Promise<[Buffer]> {
    const buf = OBJECTS.get(this.path);
    // Same shape as the real client: a missing object throws, and every caller
    // already treats that as "no such object" rather than as an outage.
    if (!buf) throw Object.assign(new Error(`No such object: ${this.path}`), { code: 404 });
    return [buf];
  }

  async delete(): Promise<void> {
    OBJECTS.delete(this.path);
  }

  async getSignedUrl(): Promise<[string]> {
    return [`https://storage.test/${this.path}`];
  }

  get name(): string {
    return this.path;
  }

  readonly metadata = { size: '0', contentType: 'application/json' };
}

class FakeBucket {
  file(path: string): FakeFile {
    return new FakeFile(path);
  }

  async getFiles({ prefix }: { prefix: string } = { prefix: '' }): Promise<[FakeFile[]]> {
    return [[...OBJECTS.keys()].filter((p) => p.startsWith(prefix)).map((p) => new FakeFile(p))];
  }
}

export class Storage {
  bucket(): FakeBucket {
    return new FakeBucket();
  }
}
