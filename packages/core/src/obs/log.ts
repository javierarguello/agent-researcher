/**
 * Structured logging for Cloud Logging.
 *
 * Cloud Run captures stdout/stderr; emitting one JSON object per line makes each
 * field queryable in Cloud Logging (`jsonPayload.jobId="…"`) and, via the
 * special `logging.googleapis.com/labels` key, an indexed **label** you can
 * filter on directly. Every job/agent step carries jobId + appId + userId so a
 * run is fully traceable and diagnosable in GCP.
 */
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface LogContext {
  jobId: string;
  appId?: string;
  userId?: string;
  template?: string;
}

/** Emit one structured log line bound to a job context. */
export function logEvent(
  ctx: LogContext,
  severity: Severity,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry: Record<string, unknown> = {
    severity,
    time: new Date().toISOString(),
    event,
    message: `[${ctx.jobId}] ${event}${fields.message ? `: ${fields.message}` : ''}`,
    jobId: ctx.jobId,
    ...(ctx.appId ? { appId: ctx.appId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.template ? { template: ctx.template } : {}),
    ...fields,
    // Indexed labels for one-click filtering in Cloud Logging.
    'logging.googleapis.com/labels': {
      jobId: ctx.jobId,
      appId: ctx.appId ?? '',
      userId: ctx.userId ?? '',
    },
  };
  const line = JSON.stringify(entry);
  if (severity === 'ERROR') console.error(line);
  else console.log(line);
}

/** Bind a context once and log against it repeatedly. */
export function jobLogger(ctx: LogContext) {
  return {
    ctx,
    debug: (event: string, fields?: Record<string, unknown>) => logEvent(ctx, 'DEBUG', event, fields),
    info: (event: string, fields?: Record<string, unknown>) => logEvent(ctx, 'INFO', event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => logEvent(ctx, 'WARNING', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => logEvent(ctx, 'ERROR', event, fields),
  };
}

export type JobLogger = ReturnType<typeof jobLogger>;
