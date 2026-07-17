import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Button, Card, Code, CopyButton, Group, Loader, Modal, ScrollArea, SimpleGrid, Stack, Table, Text, Progress,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { JobStatusBadge } from '../components/StatusBadge';
import { useJob, useRetryJob, useTemplate } from '../api/hooks';
import { ApiError, downloadFile, fetchFileText } from '../api/client';
import { config } from '../config';
import { int, secs, shortDateTime, usd } from '../lib/format';
import type { StepInfo } from '../api/types';

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
  const template = useTemplate(job?.template ?? null);
  const [viewer, setViewer] = useState<{ name: string; url: string; content: string } | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

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
          <Anchor href={`${config.appUrlPattern.replace('{appId}', job.appId)}/app/jobs/${jobId}`} target="_blank" rel="noreferrer" fw={600}>
            View report in the app ↗
          </Anchor>
          <Text size="xs" c="dimmed" mt="xs">Opens the fully-rendered report in the product app (owner/admin access).</Text>
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
