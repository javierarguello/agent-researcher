import { useState } from 'react';
import { Alert, Badge, Button, Drawer, Group, Loader, Modal, NumberInput, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { UserDetail } from '../components/UserDetail';
import { useApps, useGrantCredits, useUsers } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { int, relative, usd } from '../lib/format';

export function Users() {
  const apps = useApps();
  const { user } = useAuth();
  const grant = useGrantCredits();
  const [appId, setAppId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebouncedValue(q, 300);
  const [neverPurchased, setNeverPurchased] = useState(false);
  const users = useUsers({ appId: appId ?? undefined, q: debouncedQ || undefined, neverPurchased: neverPurchased || undefined });
  const [selected, setSelected] = useState<{ appId: string; userId: string } | null>(null);

  // Grant-to-anyone tool (works for users not yet in the list — e.g. the admin).
  const [grantOpen, setGrantOpen] = useState(false);
  const [gApp, setGApp] = useState<string | null>(user?.appId ?? 'admin');
  const [gUser, setGUser] = useState(user?.email ?? '');
  const [gCredits, setGCredits] = useState<number | ''>(10);
  const [gReason, setGReason] = useState('');

  const appOptions = (apps.data?.apps ?? []).map((a) => ({ value: a.appId, label: a.name }));

  function topUpSelf() {
    setGApp(user?.appId ?? 'admin');
    setGUser(user?.email ?? '');
    setGReason('admin top-up');
    setGrantOpen(true);
  }
  async function submitGrant() {
    if (!gApp || !gUser.trim() || !gReason.trim() || gCredits === '' || gCredits <= 0) return;
    try {
      const res = await grant.mutateAsync({ appId: gApp, userId: gUser.trim(), credits: Number(gCredits), reason: gReason.trim() });
      notifications.show({ message: `Granted ${res.granted} to ${gUser} — balance ${res.balance}`, color: 'teal' });
      setGrantOpen(false);
      setGReason('');
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  return (
    <Stack>
      <PageHeader
        eyebrow="Directory"
        title="Users"
        subtitle="Search users across apps and audit their credits."
        actions={
          <>
            <Button variant="default" onClick={topUpSelf}>Top up myself</Button>
            <Button onClick={() => setGrantOpen(true)}>Grant credits</Button>
          </>
        }
      />

      <Group>
        <Select placeholder="All apps" data={appOptions} value={appId} onChange={setAppId} clearable w={220} />
        <TextInput placeholder="Search email prefix…" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
        <Switch label="Only never-purchased" checked={neverPurchased} onChange={(e) => setNeverPurchased(e.currentTarget.checked)} />
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
                <Table.Th>Status</Table.Th>
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
                  <Table.Td>{u.hasPurchased ? <Badge color="teal" variant="light">Paying</Badge> : <Badge color="orange" variant="light">No credits</Badge>}</Table.Td>
                  <Table.Td><Mono size="sm">{int(u.reports)}</Mono></Table.Td>
                  <Table.Td><Mono size="sm">{usd(u.spentUsd)}</Mono></Table.Td>
                  <Table.Td><Mono size="sm">{int(u.creditsPurchased)}</Mono></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{relative(u.lastSeenAt)}</Text></Table.Td>
                </Table.Tr>
              ))}
              {users.data.users.length === 0 && (
                <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" size="sm">No users match.</Text></Table.Td></Table.Tr>
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

      <Modal opened={grantOpen} onClose={() => setGrantOpen(false)} title="Grant credits" size="md">
        <Stack>
          <Select label="App" data={appOptions} value={gApp} onChange={setGApp} searchable required />
          <TextInput label="User (email)" maxLength={320} value={gUser} onChange={(e) => setGUser(e.currentTarget.value)} required />
          <NumberInput label="Credits" min={1} max={1_000_000} value={gCredits} onChange={(v) => setGCredits(typeof v === 'number' ? v : '')} />
          <TextInput label="Reason" placeholder="promo, comp, testing…" maxLength={500} value={gReason} onChange={(e) => setGReason(e.currentTarget.value)} required />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button onClick={submitGrant} loading={grant.isPending} disabled={!gApp || !gUser.trim() || !gReason.trim()}>Grant</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
