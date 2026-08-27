/**
 * Cloud Storage writer + signed-URL reader for research outputs.
 *
 * Layout: gs://{bucket}/researchs/{jobId}/report.md
 *         gs://{bucket}/researchs/{jobId}/sources.json
 *         gs://{bucket}/researchs/{jobId}/assets/**
 *
 * V4 signed URLs are minted with ADC. On Cloud Run (no private key), the client
 * signs via the IAM signBlob API, so the runtime service account needs
 * roles/iam.serviceAccountTokenCreator on itself.
 */
import { Storage } from '@google-cloud/storage';
import { config } from '../config.js';
import type { JobFile } from '../jobs/types.js';

let storage: Storage | undefined;
function client(): Storage {
  if (!storage) storage = new Storage({ projectId: config.gcp.projectId });
  return storage;
}

function jobPrefix(jobId: string): string {
  return `${config.storage.rootPrefix}/${jobId}`;
}

export interface UploadInput {
  jobId: string;
  /** Object name relative to the job folder, e.g. "report.md" or "assets/chart.png". */
  name: string;
  data: string | Buffer;
  contentType: string;
}

/** Uploads one object into the job folder and returns its JobFile descriptor. */
export async function uploadObject(input: UploadInput): Promise<JobFile> {
  const path = `${jobPrefix(input.jobId)}/${input.name}`;
  const file = client().bucket(config.storage.bucket).file(path);
  const body = typeof input.data === 'string' ? Buffer.from(input.data, 'utf8') : input.data;
  await file.save(body, {
    contentType: input.contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });
  return { name: input.name, path, contentType: input.contentType, size: body.byteLength };
}

/** Downloads one object's text, or undefined if it does not exist (e.g. no checkpoint yet). */
export async function downloadObject(jobId: string, name: string): Promise<string | undefined> {
  const file = client().bucket(config.storage.bucket).file(`${jobPrefix(jobId)}/${name}`);
  try {
    const [buf] = await file.download();
    return buf.toString('utf8');
  } catch (err) {
    if ((err as { code?: number }).code === 404) return undefined;
    throw err;
  }
}

/** Downloads one object's raw bytes (for binary files like PDFs), or undefined if missing. */
export async function downloadObjectBytes(jobId: string, name: string): Promise<Buffer | undefined> {
  const file = client().bucket(config.storage.bucket).file(`${jobPrefix(jobId)}/${name}`);
  try {
    const [buf] = await file.download();
    return buf;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return undefined;
    throw err;
  }
}

/** Deletes one object (best-effort; ignores 404). */
export async function deleteObject(jobId: string, name: string): Promise<void> {
  try {
    await client().bucket(config.storage.bucket).file(`${jobPrefix(jobId)}/${name}`).delete();
  } catch (err) {
    if ((err as { code?: number }).code !== 404) throw err;
  }
}

/** Lists every object under a job folder as JobFile descriptors. */
export async function listJobFiles(jobId: string): Promise<JobFile[]> {
  const prefix = `${jobPrefix(jobId)}/`;
  const [files] = await client().bucket(config.storage.bucket).getFiles({ prefix });
  return files.map((f) => ({
    name: f.name.slice(prefix.length),
    path: f.name,
    contentType: (f.metadata.contentType as string) ?? 'application/octet-stream',
    size: f.metadata.size ? Number(f.metadata.size) : undefined,
  }));
}

/*
 * `SignedFile`, `signRead` and `signJobFiles` used to live here: V4 signed URLs
 * straight to the raw objects, minted when a job was polled as done.
 *
 * They were replaced by the authenticated proxy — `/research/:jobId/report` and
 * `/research/:jobId/files/:name`, which check the caller, redact `report.json` for
 * a non-admin and 404 the admin-only files — and then stayed exported and called by
 * nobody, a loaded helper sitting where someone reaching for the obvious answer
 * would find it. A signed URL is a bearer token for a raw object: it bypasses every
 * one of those checks for as long as it lives, and it survives being forwarded.
 *
 * Deleted 2026-08-25. If read-without-a-session is ever wanted again, the mechanism
 * that exists for it is `signReadToken` (`auth/tokens.ts`) — a scoped token the
 * proxy verifies — not a URL that answers to whoever holds it.
 */
