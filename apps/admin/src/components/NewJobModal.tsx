import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { JsonSchemaForm, defaultsFor, type JsonSchema } from './JsonSchemaForm';
import { useCreateJob, useTemplate, useTemplates } from '../api/hooks';
import { ApiError } from '../api/client';
import type { ParamsUi } from '../api/types';

/** Condensed "start a research job" dialog: pick a model, fill the params form
 *  (generated from the template's JSON-Schema + paramsUi hints), submit. */
export function NewJobModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const templates = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template = useTemplate(templateId);
  const createJob = useCreateJob();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const schema = template.data?.paramsSchema as JsonSchema | undefined;
  const ui = template.data?.paramsUi as ParamsUi | undefined;

  useEffect(() => {
    if (schema) setParams(defaultsFor(schema));
  }, [schema]);

  // Reset when the dialog closes.
  useEffect(() => {
    if (!opened) { setTemplateId(null); setParams({}); setError(null); }
  }, [opened]);

  const options = (templates.data?.templates ?? []).map((t) => ({ value: t.id, label: t.name }));

  async function submit() {
    if (!templateId) return;
    setError(null);
    try {
      const res = await createJob.mutateAsync({ template: templateId, params });
      notifications.show({ message: `Job ${res.jobId} queued`, color: 'teal' });
      onClose();
      navigate(`/jobs/${res.jobId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setError('Not enough credits on the admin account — grant yourself credits from Users first.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to start the job.');
      }
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="New research job" size="lg">
      <Stack>
        <Select
          label="Research model"
          placeholder="Choose a model"
          data={options}
          value={templateId}
          onChange={setTemplateId}
          searchable
        />

        {template.isLoading && <Loader size="sm" />}
        {template.data && schema && (
          <>
            <Text size="sm" c="dimmed">{template.data.description}</Text>
            <JsonSchemaForm schema={schema} ui={ui} modes={template.data.modes} value={params} onChange={setParams} />
          </>
        )}

        {error && <Alert color="red">{error}</Alert>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!templateId} loading={createJob.isPending}>Start job</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
