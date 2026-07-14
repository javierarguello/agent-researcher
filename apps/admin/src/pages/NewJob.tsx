import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { JsonSchemaForm, defaultsFor, type JsonSchema } from '../components/JsonSchemaForm';
import { useCreateJob, useTemplate, useTemplates } from '../api/hooks';
import { ApiError } from '../api/client';

export function NewJob() {
  const templates = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template = useTemplate(templateId);
  const createJob = useCreateJob();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const schema = template.data?.paramsSchema as JsonSchema | undefined;

  // Seed defaults whenever a new template's schema arrives.
  useEffect(() => {
    if (schema) setParams(defaultsFor(schema));
  }, [schema]);

  const options = (templates.data?.templates ?? []).map((t) => ({ value: t.id, label: t.name }));

  async function submit() {
    if (!templateId) return;
    setError(null);
    try {
      const res = await createJob.mutateAsync({ template: templateId, params });
      notifications.show({ message: `Job ${res.jobId} queued`, color: 'teal' });
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
    <Stack maw={720}>
      <PageHeader eyebrow="Research" title="New job" subtitle="Run any research model with custom parameters." />

      <Select
        label="Research model"
        placeholder="Choose a model"
        data={options}
        value={templateId}
        onChange={setTemplateId}
        searchable
      />

      {template.isLoading && <Loader />}
      {template.data && schema && (
        <Card padding="lg">
          <Text fw={650} mb={4}>{template.data.name}</Text>
          <Text size="sm" c="dimmed" mb="md">{template.data.description}</Text>
          <JsonSchemaForm schema={schema} value={params} onChange={setParams} />
        </Card>
      )}

      {error && <Alert color="red">{error}</Alert>}

      <Group justify="flex-end">
        <Button onClick={submit} disabled={!templateId} loading={createJob.isPending}>
          Start job
        </Button>
      </Group>
    </Stack>
  );
}
