import { Alert, Card, Group, Loader, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { useAdminStats } from '../api/hooks';
import { int, secs, usd } from '../lib/format';

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.06em' }}>{label}</Text>
      <Mono fw={700} fz={28} c={accent}>{value}</Mono>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Card>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useAdminStats(30);

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return null;
  const t = data.totals;

  return (
    <Stack>
      <PageHeader eyebrow="Overview" title="Dashboard" subtitle="Last 30 days across all apps." />

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }}>
        <Kpi label="Reports" value={int(t.reports)} hint={`${int(t.reportsCompleted)} completed`} />
        <Kpi
          label="Users"
          value={int(t.users)}
          hint={`${int(t.payingUsers)} paying · ${int(Math.max(0, t.users - t.payingUsers))} never bought`}
        />
        <Kpi label="Errors" value={int(t.reportsFailed)} hint="failed reports" accent={t.reportsFailed > 0 ? 'red' : undefined} />
        <Kpi label="Degraded" value={int(t.degradedReports)} hint="partial delivery" accent={t.degradedReports > 0 ? 'yellow' : undefined} />
        <Kpi label="Revenue" value={usd(t.revenueUsd)} hint={`${int(t.purchases)} purchases`} accent="teal" />
        <Kpi label="Cost" value={usd(t.costUsd)} hint="LLM + search" />
        <Kpi label="Avg gen" value={secs(t.avgGenMs)} hint={`${secs(t.genTimeMsMin)}–${secs(t.genTimeMsMax)}`} />
      </SimpleGrid>

      <Card padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={650}>By app</Text>
          <Text size="sm" c="dimmed">{data.apps.length} apps</Text>
        </Group>
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>App</Table.Th>
                <Table.Th ta="right">Reports</Table.Th>
                <Table.Th ta="right">Errors</Table.Th>
                <Table.Th ta="right">Users</Table.Th>
                <Table.Th ta="right">Revenue</Table.Th>
                <Table.Th ta="right">Avg gen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.apps.map((a) => (
                <Table.Tr key={a.appId}>
                  <Table.Td><Mono size="sm">{a.appId}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{int(a.reports)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm" c={a.reportsFailed > 0 ? 'red' : undefined}>{int(a.reportsFailed)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{int(a.users)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{usd(a.revenueUsd)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{secs(a.avgGenMs)}</Mono></Table.Td>
                </Table.Tr>
              ))}
              {data.apps.length === 0 && (
                <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" size="sm">No activity yet.</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
