import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Button, Card, Code, CopyButton, Group, Loader, Modal, NumberInput, ScrollArea, SimpleGrid, Stack, Table, Text, Progress,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { FailureKindBadge, JobStatusBadge } from '../components/StatusBadge';
import { useJob, useGrantCredits, useResolveHold, useRetryJob, useTemplate } from '../api/hooks';
import { api, ApiError, downloadFile, ensureReportPdf, fetchFileText } from '../api/client';
import { config } from '../config';
import { int, relative, secs, shortDateTime, usd } from '../lib/format';
import type { JobFailureKind, StepInfo } from '../api/types';

/** What each hold means, in one line, for whoever has to decide. */
const HOLD_BLURB: Record<JobFailureKind, string> = {
  budget_exceeded:
    'It passed its cost ceiling. Continuing costs more money and resumes from where it stopped — nothing already done is re-run.',
  upload_failed:
    'The report was produced but could not be stored. Continuing re-uploads it; the research is not re-run.',
  run_failed: 'It could not be completed. Continuing retries the steps that failed, from the checkpoint.',
};

const AGENT_COLOR: Record<string, string> = { ok: 'teal', failed: 'red', pending: 'yellow', running: 'blue' };
const fmtParam = (v: unknown): string =>
  Array.isArray(v) ? (v.length ? v.join(', ') : '—') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null || v === '' ? '—' : String(v);

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.05em' }}>{label}</Text>
      <Text size="sm">{children}</Text>
    </div>
  );
}

export function JobDetail() {
  const { jobId = '' } = useParams();
  const navigate = useNavigate();
  const { data: job, isLoading, error } = useJob(jobId);
  const retry = useRetryJob();
  const resolve = useResolveHold();
  const grant = useGrantCredits();
  const [topUp, setTopUp] = useState(1);
  const template = useTemplate(job?.template ?? null);
  const [viewer, setViewer] = useState<{ name: string; url: string; content: string } | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [pdfState, setPdfState] = useState<'idle' | 'working'>('idle');

  async function downloadPdf() {
    if (pdfState === 'working') return;
    setPdfState('working');
    try {
      const name = `${(job?.title ?? 'report').replace(/[^\w\- ]+/g, '').trim() || 'report'}.pdf`;
      await ensureReportPdf(jobId, name);
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Could not download PDF', color: 'red' });
    } finally {
      setPdfState('idle');
    }
  }

  /** Mint a short-lived read-only token for this report, then open the app's
   *  /report/:jobId page with it so the admin sees the report exactly as the user. */
  async function openInApp() {
    setOpening(true);
    try {
      const { token, appId } = await api<{ token: string; appId: string }>(`/admin/jobs/${jobId}/read-token`, { method: 'POST' });
      const base = config.appUrlPattern.replace('{appId}', appId);
      window.open(`${base}/report/${jobId}?rt=${encodeURIComponent(token)}`, '_blank', 'noopener');
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Could not open report', color: 'red' });
    } finally {
      setOpening(false);
    }
  }

  async function openViewer(f: { name: string; url: string }) {
    setViewerLoading(true);
    try {
      const text = await fetchFileText(f.url);
      let content = text;
      if (f.name.endsWith('.json')) {
        try { content = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show raw */ }
      }
      setViewer({ name: f.name, url: f.url, content });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Could not load file', color: 'red' });
    } finally {
      setViewerLoading(false);
    }
  }

  async function onRetry() {
    try {
      await retry.mutateAsync(jobId);
      notifications.show({ message: 'Job re-queued', color: 'teal' });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Retry failed', color: 'red' });
    }
  }

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!job) return null;

  const live = job.status === 'queued' || job.status === 'running' || job.status === 'incomplete';
  const canRetry = job.status === 'failed' || job.status === 'incomplete';
  const s = job.summary;
  // Map a workflow phase/agent id → its localized label + description.
  const stepsById: Record<string, StepInfo> = Object.fromEntries((template.data?.steps ?? []).map((st) => [st.id, st]));
  const stepLabel = (id: string) => stepsById[id]?.label ?? id;
  const currentStep = job.progress ? stepsById[job.progress.phase] : undefined;

  return (
    <Stack>
      <PageHeader
        eyebrow="Job"
        title={job.title || jobId}
        subtitle={job.title ? jobId : undefined}
        actions={
          <>
            {canRetry && <Button color="violet" loading={retry.isPending} onClick={onRetry}>Retry</Button>}
            <Button variant="default" onClick={() => navigate('/jobs')}>Back</Button>
          </>
        }
      />

      <Card padding="lg">
        <Group justify="space-between" mb="md">
          <Group gap="sm">
            <JobStatusBadge status={job.status} />
            {job.failureKind && <FailureKindBadge kind={job.failureKind} />}
            {live && <Badge variant="dot" color="blue">live</Badge>}
          </Group>
          <Mono size="sm" c="dimmed">{usd(job.cost?.usd)}</Mono>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Meta label="Model">{job.template}</Meta>
          <Meta label="App">{<Mono size="sm">{job.appId}</Mono>}</Meta>
          <Meta label="User">{<Mono size="sm">{job.userId}</Mono>}</Meta>
          <Meta label="Created">{shortDateTime(job.createdAt)}</Meta>
          {s?.attempts != null && <Meta label="Dispatches">{int(s.attempts)}</Meta>}
          {s?.durationMs != null && <Meta label="Total time">{secs(s.durationMs)}</Meta>}
          {s?.sourcesFound != null && <Meta label="Sources">{int(s.sourcesFound)}</Meta>}
          {s?.turnsUsed != null && <Meta label="Search turns">{int(s.turnsUsed)}</Meta>}
        </SimpleGrid>
      </Card>

      {job.params && Object.keys(job.params).length > 0 && (
        <Card padding="lg">
          <Text fw={650} mb="sm">Request params</Text>
          <SimpleGrid cols={{ base: 2, sm: 3 }}>
            {Object.entries(job.params).map(([k, v]) => (
              <Meta key={k} label={k}>{fmtParam(v)}</Meta>
            ))}
          </SimpleGrid>
        </Card>
      )}

      {live && job.progress && (
        <Card padding="lg">
          <Group justify="space-between" mb="xs">
            <Text fw={650}>{currentStep?.label ?? stepLabel(job.progress.phase)}</Text>
            <Text size="sm" c="dimmed">{int(job.progress.sourcesFound)} sources · {int(job.progress.turnsUsed)} turns</Text>
          </Group>
          {currentStep?.description && <Text size="sm" mb={4}>{currentStep.description}</Text>}
          <Text size="sm" c="dimmed" mb="sm">{job.progress.message}</Text>
          <Progress value={100} animated />
        </Card>
      )}

      {/* Outside the `held` gate on purpose.
          The refund runs AFTER the job is flipped to `failed`, so by the time it
          can fail the decision card has already unmounted — taking the warning and
          the button it tells you to press with it. The admin saw the job go quietly
          to failed with the buyer unpaid, indistinguishable from success.
          `resolvedOutcome === 'refund'` with nothing in the ledger is exactly the
          stranded state, and it survives a page reload, which `resolve.data` does
          not. */}
      {job.status === 'failed' && job.hold?.resolvedOutcome === 'refund' && job.refunded === false && (
        <Card padding="lg" withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
          <Text fw={650} mb="xs">The refund did not go through</Text>
          <Text size="sm" c="dimmed" mb="md">
            This job is closed and the buyer has <b>not</b> been paid back. Pressing the button below
            finishes the refund that was decided on {job.hold.resolvedAt ? relative(job.hold.resolvedAt) : 'earlier'}
            {job.hold.resolvedBy ? ` by ${job.hold.resolvedBy}` : ''}. It is safe to press more than once.
          </Text>
          <Button
            color="red"
            loading={resolve.isPending && resolve.variables?.action === 'refund'}
            onClick={() => resolve.mutate({ jobId, action: 'refund' })}
          >
            Finish the refund
          </Button>
        </Card>
      )}

      {/* What actually happened to the money, for a closed job. The page used to
          assert "the user's credits were refunded" from `failureKind` alone, which
          `rejectHold` copies from the hold whatever the admin chose — so it said the
          opposite of the truth after a dismiss. This reads the ledger. */}
      {job.status === 'failed' && job.hold?.resolvedOutcome && job.refunded !== undefined && (
        <Text size="sm" c="dimmed">
          {job.refunded
            ? 'Closed — credits returned to the buyer.'
            : job.hold.resolvedOutcome === 'dismiss'
              ? 'Closed without a refund (deliberate).'
              : 'Closed — refund still pending.'}
          {job.hold.resolvedBy ? ` Decided by ${job.hold.resolvedBy}.` : ''}
        </Text>
      )}

      {job.status === 'held' && job.hold && (
        <Card padding="lg" withBorder style={{ borderColor: 'var(--mantine-color-orange-5)' }}>
          <Group justify="space-between" mb="xs">
            <Text fw={650}>Needs a decision</Text>
            <Text size="xs" c="dimmed">held {relative(job.hold.heldAt)}</Text>
          </Group>

          <Text size="sm" c="dimmed" mb="xs">
            {HOLD_BLURB[job.hold.reason] ?? 'This job stopped and needs a decision.'}{' '}
            <Mono size="sm">{usd(job.hold.spentUsd)}</Mono> was already spent. Nothing happens until you
            choose — the buyer&apos;s credits stay consumed while it waits.
          </Text>
          {job.hold.detail && (
            <Code block mb="md" style={{ fontSize: 12 }}>
              {job.hold.detail}
            </Code>
          )}

          <Group gap="sm">
            <Button
              color="orange"
              loading={resolve.isPending && resolve.variables?.action === 'approve'}
              onClick={() => resolve.mutate({ jobId, action: 'approve' })}
            >
              Continue the job
            </Button>
            <Button
              variant="default"
              loading={resolve.isPending && resolve.variables?.action === 'refund'}
              onClick={() => resolve.mutate({ jobId, action: 'refund' })}
            >
              Refund &amp; close
            </Button>
            <Button
              variant="subtle"
              color="gray"
              loading={resolve.isPending && resolve.variables?.action === 'dismiss'}
              onClick={() => resolve.mutate({ jobId, action: 'dismiss' })}
            >
              Close without refund
            </Button>
          </Group>

          {/* Top-up is a grant, not a refund: it goes on the ledger as its own kind
              of entry, with the amount and the reason you chose. Closing the job is
              still a separate call, because giving credits and deciding this job's
              fate are two different judgements. */}
          <Group gap="sm" mt="md" align="flex-end">
            <NumberInput
              label="Top up instead"
              description="Credits to grant this buyer"
              min={1}
              max={1000}
              w={190}
              value={topUp}
              onChange={(v: string | number) => setTopUp(typeof v === 'number' ? v : Number(v) || 1)}
            />
            <Button
              variant="light"
              loading={grant.isPending}
              onClick={() =>
                grant.mutate({
                  appId: job.appId,
                  userId: job.userId,
                  credits: topUp,
                  reason: `top-up for held job ${jobId} (${job.hold?.reason})`,
                })
              }
            >
              Grant {topUp} credits
            </Button>
            {grant.isSuccess && <Text size="sm" c="teal">Granted.</Text>}
          </Group>

          {(resolve.isError || grant.isError) && (
            <Text size="sm" c="red" mt="sm">
              {((resolve.error ?? grant.error) as Error).message}
            </Text>
          )}
          {/* A 200 is not the same as the money moving: the refund runs after the
              job is closed, so it can fail on its own. Saying so is the difference
              between an admin who retries and one who thinks they are done. */}
          {resolve.data?.refundFailed && (
            <Text size="sm" c="red" mt="sm">
              The job is closed, but the refund did not go through. The buyer has not been paid back — use
              “Finish the refund” on this page.
            </Text>
          )}
        </Card>
      )}

      {job.status === 'failed' && job.failureKind === 'budget_exceeded' && (
        // Says only what the job document actually knows.
        //
        // It used to assert "the user's credits were refunded" from `failureKind`
        // alone — which is copied from the hold's reason whether the admin refunded,
        // dismissed, or hit a refund that failed. It stated the opposite of what had
        // happened on two of those three paths. The ledger is the only record, and
        // the resolution note rendered just below now carries the outcome.
        //
        // It also named MAX_JOB_COST_USD as the limit that was hit. The ceiling the
        // engine enforces is the MODEL's (`modes[key].maxCostUsd`), falling back to
        // that default — so on a catalog model with its own ceiling the env var was
        // simply the wrong number.
        <Alert color="orange" title="Stopped at the per-job cost ceiling">
          <Text size="sm">
            This job passed its per-job cost ceiling and was stopped. The{' '}
            <Mono size="sm">{usd(job.cost?.usd)}</Mono> below was spent either way.
          </Text>
        </Alert>
      )}
      {job.error && <Alert color="red" title="Job error">{job.error}</Alert>}

      {s?.warnings && s.warnings.length > 0 && (
        <Alert color="yellow" title="Warnings — review what happened">
          <Stack gap={4}>{s.warnings.map((w, i) => <Text key={i} size="sm">{w}</Text>)}</Stack>
        </Alert>
      )}

      {s?.agents && s.agents.length > 0 && (
        <Card padding="lg">
          <Text fw={650} mb="sm">Agents</Text>
          <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Agent</Table.Th>
                  <Table.Th ta="right">Wave</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Duration</Table.Th>
                  <Table.Th ta="right">Tries</Table.Th>
                  <Table.Th ta="right">Cost</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.agents.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      <Text size="sm">{stepLabel(a.id)}</Text>
                      <Mono size="xs" c="dimmed">{a.id}</Mono>
                    </Table.Td>
                    <Table.Td ta="right"><Mono size="sm">{a.wave}</Mono></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={AGENT_COLOR[a.status] ?? 'gray'} tt="none">{a.status}</Badge></Table.Td>
                    <Table.Td ta="right"><Mono size="sm">{secs(a.durationMs)}</Mono></Table.Td>
                    <Table.Td ta="right"><Mono size="sm" c={a.attempts > 1 ? 'yellow' : undefined}>{a.attempts}</Mono></Table.Td>
                    <Table.Td ta="right"><Mono size="sm">{usd(a.costUsd)}</Mono></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {job.status === 'completed' && (
        <Card padding="lg">
          <Text fw={650} mb="sm">Report</Text>
          <Group gap="sm">
            <Button variant="light" loading={opening} onClick={openInApp}>
              View report in the app ↗
            </Button>
            <Button variant="default" loading={pdfState === 'working'} onClick={downloadPdf}>
              {pdfState === 'working' ? 'Preparing PDF…' : 'Download PDF ↓'}
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            View opens a read-only preview in the product app (scoped to this report, expires in 15 min).
            The PDF is generated once on first download, then reused.
          </Text>
        </Card>
      )}

      {job.status === 'completed' && job.files && job.files.length > 0 && (
        <Card padding="lg">
          <Text fw={650} mb="sm">Files</Text>
          <Stack gap="xs">
            {job.files.map((f) => (
              <Group key={f.name} justify="space-between">
                <Group gap="xs">
                  <Mono size="sm">{f.name}</Mono>
                  <Text size="xs" c="dimmed">{f.contentType}{f.size != null ? ` · ${int(f.size)} B` : ''}</Text>
                </Group>
                <Group gap="md">
                  <Anchor component="button" type="button" onClick={() => openViewer(f)} size="sm">View</Anchor>
                  <Anchor component="button" type="button" onClick={() => downloadFile(f.url, f.name).catch(() => {})} size="sm">Download</Anchor>
                </Group>
              </Group>
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt="xs">Files are served only through your authenticated session — no shareable links.</Text>
        </Card>
      )}

      <Modal
        opened={viewerLoading || !!viewer}
        onClose={() => setViewer(null)}
        title={<Mono size="sm">{viewer?.name ?? 'Loading…'}</Mono>}
        size="80rem"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {viewerLoading ? (
          <Group justify="center" py="xl"><Loader /></Group>
        ) : viewer ? (
          <>
            <Group justify="flex-end" mb="sm" gap="xs">
              <CopyButton value={viewer.content}>
                {({ copied, copy }) => <Button size="xs" variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}
              </CopyButton>
              <Button size="xs" variant="default" onClick={() => downloadFile(viewer.url, viewer.name).catch(() => {})}>Download</Button>
            </Group>
            <Code block style={{ maxHeight: '65vh', overflow: 'auto', fontSize: 12, lineHeight: 1.5 }}>{viewer.content}</Code>
          </>
        ) : null}
      </Modal>
    </Stack>
  );
}
