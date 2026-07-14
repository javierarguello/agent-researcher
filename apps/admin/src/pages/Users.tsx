import { useState } from 'react';
import { Alert, Drawer, Group, Loader, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { UserDetail } from '../components/UserDetail';
import { useApps, useUsers } from '../api/hooks';
import { int, relative, usd } from '../lib/format';

export function Users() {
  const apps = useApps();
  const [appId, setAppId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebouncedValue(q, 300);
  const users = useUsers({ appId: appId ?? undefined, q: debouncedQ || undefined });
  const [selected, setSelected] = useState<{ appId: string; userId: string } | null>(null);

  const appOptions = (apps.data?.apps ?? []).map((a) => ({ value: a.appId, label: a.name }));

  return (
    <Stack>
      <PageHeader eyebrow="Directory" title="Users" subtitle="Search users across apps and audit their credits." />

      <Group>
        <Select placeholder="All apps" data={appOptions} value={appId} onChange={setAppId} clearable w={220} />
        <TextInput placeholder="Search email prefix…" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
      </Group>

      {users.isLoading && <Loader />}
      {users.error && <Alert color="red">{(users.error as Error).message}</Alert>}
      {users.data && (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>App</Table.Th>
                <Table.Th>Reports</Table.Th>
                <Table.Th>Spent</Table.Th>
                <Table.Th>Credits bought</Table.Th>
                <Table.Th>Last seen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.data.users.map((u) => (
                <Table.Tr
                  key={`${u.appId}__${u.userId}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected({ appId: u.appId, userId: u.userId })}
                >
                  <Table.Td><Mono size="sm">{u.userId}</Mono></Table.Td>
                  <Table.Td><Mono size="xs" c="dimmed">{u.appId}</Mono></Table.Td>
                  <Table.Td><Mono size="sm">{int(u.reports)}</Mono></Table.Td>
                  <Table.Td><Mono size="sm">{usd(u.spentUsd)}</Mono></Table.Td>
                  <Table.Td><Mono size="sm">{int(u.creditsPurchased)}</Mono></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{relative(u.lastSeenAt)}</Text></Table.Td>
                </Table.Tr>
              ))}
              {users.data.users.length === 0 && (
                <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" size="sm">No users match.</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        position="right"
        size="lg"
        title="User"
        padding="lg"
      >
        {selected && <UserDetail appId={selected.appId} userId={selected.userId} />}
      </Drawer>
    </Stack>
  );
}
