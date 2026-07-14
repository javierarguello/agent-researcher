import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Group, Loader, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { JobStatusBadge } from '../components/StatusBadge';
import { useApps, useJobs, useTemplates } from '../api/hooks';
import { relative, usd } from '../lib/format';

const STATUSES = ['queued', 'running', 'completed', 'failed', 'incomplete'];

export function Jobs() {
  const navigate = useNavigate();
  const apps = useApps();
  const templates = useTemplates();
  const [appId, setAppId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [debouncedUser] = useDebouncedValue(userId, 300);
  const jobs = useJobs({
    appId: appId ?? undefined,
    status: status ?? undefined,
    template: template ?? undefined,
    userId: debouncedUser || undefined,
  });

  const appOptions = (apps.data?.apps ?? []).map((a) => ({ value: a.appId, label: a.name }));
  const templateOptions = (templates.data?.templates ?? []).map((t) => ({ value: t.id, label: t.name }));

  return (
    <Stack>
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        subtitle="Every research job across apps."
        actions={<Button onClick={() => navigate('/jobs/new')}>New job</Button>}
      />

      <Group>
        <Select placeholder="All apps" data={appOptions} value={appId} onChange={setAppId} clearable w={180} />
        <Select placeholder="Any status" data={STATUSES} value={status} onChange={setStatus} clearable w={160} />
        <Select placeholder="Any model" data={templateOptions} value={template} onChange={setTemplate} clearable w={220} searchable />
        <TextInput placeholder="User email…" value={userId} onChange={(e) => setUserId(e.currentTarget.value)} w={220} />
      </Group>

      {jobs.isLoading && <Loader />}
      {jobs.error && <Alert color="red">{(jobs.error as Error).message}</Alert>}
      {jobs.data && (
        <Table.ScrollContainer minWidth={820}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Job</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>App / user</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Cost</Table.Th>
                <Table.Th ta="right">Tries</Table.Th>
                <Table.Th ta="right">Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {jobs.data.jobs.map((j) => (
                <Table.Tr key={j.jobId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${j.jobId}`)}>
                  <Table.Td>
                    <Mono size="xs">{j.jobId}</Mono>
                    {j.title && <Text size="xs" c="dimmed" lineClamp={1}>{j.title}</Text>}
                  </Table.Td>
                  <Table.Td><Text size="sm">{j.template}</Text></Table.Td>
                  <Table.Td>
                    <Mono size="xs">{j.appId}</Mono>
                    <Text size="xs" c="dimmed" lineClamp={1}>{j.userId}</Text>
                  </Table.Td>
                  <Table.Td><JobStatusBadge status={j.status} /></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{usd(j.cost?.usd)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{j.attempts ?? '—'}</Mono></Table.Td>
                  <Table.Td ta="right"><Text size="xs" c="dimmed">{relative(j.createdAt)}</Text></Table.Td>
                </Table.Tr>
              ))}
              {jobs.data.jobs.length === 0 && (
                <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" size="sm">No jobs match.</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
