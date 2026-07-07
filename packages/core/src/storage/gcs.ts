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

export interface SignedFile extends JobFile {
  url: string;
  expiresAt: string;
}

/** Mints a read-only V4 signed URL for one object path. */
export async function signRead(path: string, ttlMinutes = config.storage.signedUrlTtlMinutes): Promise<string> {
  const expires = Date.now() + ttlMinutes * 60_000;
  const [url] = await client()
    .bucket(config.storage.bucket)
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'read', expires });
  return url;
}

/** Signs read URLs for every file of a job (used when a job is polled as done). */
export async function signJobFiles(files: JobFile[], ttlMinutes = config.storage.signedUrlTtlMinutes): Promise<SignedFile[]> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  return Promise.all(
    files.map(async (f) => ({ ...f, url: await signRead(f.path, ttlMinutes), expiresAt })),
  );
}
