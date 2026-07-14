import { useQuery } from '@tanstack/react-query';
import { SimpleGrid, Card, Text, Title, Group, Table, Loader, Alert, Stack } from '@mantine/core';
import { api } from '../api/client';
import type { AdminStats } from '../api/types';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={700}>{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Card>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api<AdminStats>('/admin/stats?days=30'),
  });

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return null;
  const t = data.totals;

  return (
    <Stack>
      <Title order={2}>Dashboard</Title>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <Kpi label="Reports" value={String(t.reports)} hint={`${t.reportsCompleted} completed`} />
        <Kpi label="Errors" value={String(t.reportsFailed)} hint="failed reports" />
        <Kpi label="Degraded" value={String(t.degradedReports)} hint="partial reports" />
        <Kpi label="Revenue" value={usd(t.revenueUsd)} hint={`${t.purchases} purchases`} />
        <Kpi label="Cost" value={usd(t.costUsd)} hint="LLM + search" />
        <Kpi label="Avg gen" value={secs(t.avgGenMs)} hint={`${secs(t.genTimeMsMin)}–${secs(t.genTimeMsMax)}`} />
      </SimpleGrid>

      <Card withBorder padding="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>By app</Title>
          <Text size="sm" c="dimmed">{data.apps.length} apps</Text>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>App</Table.Th>
              <Table.Th>Reports</Table.Th>
              <Table.Th>Errors</Table.Th>
              <Table.Th>Users</Table.Th>
              <Table.Th>Revenue</Table.Th>
              <Table.Th>Avg gen</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.apps.map((a) => (
              <Table.Tr key={a.appId}>
                <Table.Td>{a.appId}</Table.Td>
                <Table.Td>{a.reports}</Table.Td>
                <Table.Td>{a.reportsFailed}</Table.Td>
                <Table.Td>{a.users}</Table.Td>
                <Table.Td>{usd(a.revenueUsd)}</Table.Td>
                <Table.Td>{secs(a.avgGenMs)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
