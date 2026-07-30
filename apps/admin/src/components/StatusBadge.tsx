import { Badge, Tooltip } from '@mantine/core';
import type { JobFailureKind, JobStatus, LedgerEntry } from '../api/types';

const JOB_COLORS: Record<JobStatus, string> = {
  queued: 'gray',
  running: 'blue',
  completed: 'teal',
  failed: 'red',
  incomplete: 'yellow',
  // Orange, not red: a held job has not failed. It is waiting on us.
  held: 'orange',
};

const LEDGER_COLORS: Record<LedgerEntry['type'], string> = {
  purchase: 'teal',
  grant: 'violet',
  consumption: 'gray',
  refund: 'orange',
};

/** One visual language for job status across the app. */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge color={JOB_COLORS[status] ?? 'gray'} variant="light" radius="sm" tt="none">
      {status}
    </Badge>
  );
}

const FAILURE_LABEL: Record<JobFailureKind, { label: string; help: string }> = {
  budget_exceeded: {
    label: 'cost ceiling',
    help: 'This job passed its per-job cost ceiling. Continuing it costs more money, so it needs a decision.',
  },
  upload_failed: {
    label: 'upload failed',
    help: 'The report was produced and paid for but could not be stored. It needs re-uploading, not re-running — approve to retry.',
  },
};

/**
 * Why a job failed, when it was OUR limit rather than the model. Sits next to the
 * `failed` badge instead of replacing it: the status is still failed, and this says
 * that the failure cost money nobody paid for.
 */
export function FailureKindBadge({ kind }: { kind: JobFailureKind }) {
  const it = FAILURE_LABEL[kind];
  if (!it) return null;
  return (
    <Tooltip label={it.help} withArrow multiline w={260}>
      <Badge color="orange" variant="outline" radius="sm" tt="none">
        {it.label}
      </Badge>
    </Tooltip>
  );
}

/** Same language for credit-ledger entry types (the audit trail). */
export function LedgerTypeBadge({ type }: { type: LedgerEntry['type'] }) {
  return (
    <Badge color={LEDGER_COLORS[type] ?? 'gray'} variant="light" radius="sm" tt="none">
      {type}
    </Badge>
  );
}
