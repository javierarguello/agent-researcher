import { Badge } from '@mantine/core';
import type { JobStatus, LedgerEntry } from '../api/types';

const JOB_COLORS: Record<JobStatus, string> = {
  queued: 'gray',
  running: 'blue',
  completed: 'teal',
  failed: 'red',
  incomplete: 'yellow',
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

/** Same language for credit-ledger entry types (the audit trail). */
export function LedgerTypeBadge({ type }: { type: LedgerEntry['type'] }) {
  return (
    <Badge color={LEDGER_COLORS[type] ?? 'gray'} variant="light" radius="sm" tt="none">
      {type}
    </Badge>
  );
}
