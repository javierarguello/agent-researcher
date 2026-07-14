import { useState } from 'react';
import {
  Alert, Badge, Button, Code, CopyButton, Group, Loader, Modal, MultiSelect, NumberInput,
  Select, Stack, Switch, Table, TagsInput, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { useApps, useCreateApp, useDeleteApp, useTemplates, useUpdateApp } from '../api/hooks';
import { ApiError } from '../api/client';
import type { AppPublic } from '../api/types';

interface FormState {
  name: string;
  appId: string;
  role: 'app' | 'admin';
  active: boolean;
  rateLimitPerHour: number | '';
  allowedTemplates: string[];
  googleClientId: string;
  adminEmails: string[];
}

const empty: FormState = { name: '', appId: '', role: 'app', active: true, rateLimitPerHour: '', allowedTemplates: [], googleClientId: '', adminEmails: [] };

export function Apps() {
  const apps = useApps();
  const templates = useTemplates();
  const createApp = useCreateApp();
  const updateApp = useUpdateApp();
  const deleteApp = useDeleteApp();

  const [editing, setEditing] = useState<AppPublic | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AppPublic | null>(null);

  const templateOptions = (templates.data?.templates ?? []).map((t) => ({ value: t.id, label: t.name }));

  function openCreate() {
    setForm(empty);
    setEditing(null);
    setCreating(true);
  }
  function openEdit(a: AppPublic) {
    setForm({
      name: a.name,
      appId: a.appId,
      role: a.role,
      active: a.active,
      rateLimitPerHour: a.rateLimitPerHour ?? '',
      allowedTemplates: a.allowedTemplates ?? [],
      googleClientId: a.googleClientId ?? '',
      adminEmails: a.adminEmails ?? [],
    });
    setEditing(a);
    setCreating(false);
  }
  const modalOpen = creating || !!editing;
  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function submit() {
    const rate = form.rateLimitPerHour === '' ? undefined : Number(form.rateLimitPerHour);
    try {
      if (editing) {
        await updateApp.mutateAsync({
          appId: editing.appId,
          patch: {
            name: form.name,
            active: form.active,
            rateLimitPerHour: rate ?? null,
            allowedTemplates: form.allowedTemplates,
            googleClientId: form.googleClientId || undefined,
            adminEmails: form.adminEmails,
          },
        });
        notifications.show({ message: `Updated ${editing.appId}`, color: 'teal' });
        closeModal();
      } else {
        const res = await createApp.mutateAsync({
          name: form.name,
          appId: form.appId || undefined,
          role: form.role,
          rateLimitPerHour: rate,
          allowedTemplates: form.allowedTemplates.length ? form.allowedTemplates : undefined,
          googleClientId: form.googleClientId || undefined,
          adminEmails: form.adminEmails.length ? form.adminEmails : undefined,
        });
        closeModal();
        setNewApiKey((res.app as unknown as { apiKey: string }).apiKey);
      }
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await deleteApp.mutateAsync(toDelete.appId);
      notifications.show({ message: `Deleted ${toDelete.appId}`, color: 'teal' });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    } finally {
      setToDelete(null);
    }
  }

  return (
    <Stack>
      <PageHeader
        eyebrow="Registry"
        title="Apps"
        subtitle="Client apps that may call the API. Well-known apps use a slug doc id."
        actions={<Button onClick={openCreate}>New app</Button>}
      />

      {apps.isLoading && <Loader />}
      {apps.error && <Alert color="red">{(apps.error as Error).message}</Alert>}
      {apps.data && (
        <Table.ScrollContainer minWidth={720}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>App</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Rate/h</Table.Th>
                <Table.Th>Allowed models</Table.Th>
                <Table.Th>API key</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {apps.data.apps.map((a) => (
                <Table.Tr key={a.appId}>
                  <Table.Td>
                    <Text fw={600}>{a.name}</Text>
                    <Mono size="xs" c="dimmed">{a.appId}</Mono>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={a.role === 'admin' ? 'grape' : 'gray'} tt="none">{a.role}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="dot" color={a.active ? 'teal' : 'red'} tt="none">{a.active ? 'active' : 'inactive'}</Badge>
                  </Table.Td>
                  <Table.Td><Mono size="sm">{a.rateLimitPerHour ?? '∞'}</Mono></Table.Td>
                  <Table.Td>
                    {a.allowedTemplates?.length ? (
                      <Group gap={4}>
                        {a.allowedTemplates.map((t) => <Badge key={t} size="sm" variant="outline" tt="none">{t}</Badge>)}
                      </Group>
                    ) : <Text size="sm" c="dimmed">any</Text>}
                  </Table.Td>
                  <Table.Td><Mono size="xs" c="dimmed">{a.apiKeyPreview}</Mono></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button size="compact-sm" variant="subtle" onClick={() => openEdit(a)}>Edit</Button>
                      <Tooltip label="Delete app" withArrow>
                        <Button size="compact-sm" variant="subtle" color="red" onClick={() => setToDelete(a)}>Delete</Button>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {/* Create / edit modal */}
      <Modal opened={modalOpen} onClose={closeModal} title={editing ? `Edit ${editing.appId}` : 'New app'} size="lg">
        <Stack>
          <Group justify="space-between" align="flex-end">
            <TextInput label="Name" style={{ flex: 1 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required />
            {editing && <Switch label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })} mb={6} />}
          </Group>
          {!editing && (
            <Group grow>
              <TextInput label="App id (slug)" placeholder="auto UUID if empty" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.currentTarget.value })} />
              <Select label="Role" data={['app', 'admin']} value={form.role} onChange={(v) => setForm({ ...form, role: (v as 'app' | 'admin') ?? 'app' })} />
            </Group>
          )}
          <NumberInput label="Rate limit (reports/hour)" placeholder="unlimited" min={1} value={form.rateLimitPerHour} onChange={(v) => setForm({ ...form, rateLimitPerHour: typeof v === 'number' ? v : '' })} />
          <MultiSelect
            label="Allowed models"
            description="Empty = any model. Admin apps ignore this."
            data={templateOptions}
            value={form.allowedTemplates}
            onChange={(v) => setForm({ ...form, allowedTemplates: v })}
            searchable
            clearable
          />
          <TextInput label="Google client id" description="Frontend OAuth client for login." value={form.googleClientId} onChange={(e) => setForm({ ...form, googleClientId: e.currentTarget.value })} />
          <TagsInput label="Admin emails" description="For admin apps: who may log in." value={form.adminEmails} onChange={(v) => setForm({ ...form, adminEmails: v })} />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={closeModal}>Cancel</Button>
            <Button onClick={submit} loading={createApp.isPending || updateApp.isPending} disabled={!form.name}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Show the freshly-created apiKey once */}
      <Modal opened={!!newApiKey} onClose={() => setNewApiKey(null)} title="App created" size="lg">
        <Stack>
          <Alert color="yellow" title="Save this API key — it is shown only once.">
            <Group justify="space-between" wrap="nowrap" align="center">
              <Code style={{ wordBreak: 'break-all' }}>{newApiKey}</Code>
              <CopyButton value={newApiKey ?? ''}>
                {({ copied, copy }) => <Button size="compact-sm" onClick={copy} color={copied ? 'teal' : 'violet'}>{copied ? 'Copied' : 'Copy'}</Button>}
              </CopyButton>
            </Group>
          </Alert>
          <Group justify="flex-end"><Button onClick={() => setNewApiKey(null)}>Done</Button></Group>
        </Stack>
      </Modal>

      {/* Delete confirm */}
      <Modal opened={!!toDelete} onClose={() => setToDelete(null)} title="Delete app" size="md">
        <Stack>
          <Text>Delete <Mono>{toDelete?.appId}</Mono>? This cannot be undone.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button color="red" onClick={confirmDelete} loading={deleteApp.isPending}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
