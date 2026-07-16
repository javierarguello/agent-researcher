import { useEffect, useState } from 'react';
import { Alert, Button, Card, Divider, Group, Loader, NumberInput, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { usePricing, useSetPricing, useTemplates } from '../api/hooks';
import { ApiError } from '../api/client';

function PricingCard({ templateId, name }: { templateId: string; name: string }) {
  const pricing = usePricing(templateId);
  const save = useSetPricing();
  const [modes, setModes] = useState<Record<string, number>>({});
  const [addons, setAddons] = useState<Record<string, number>>({});

  useEffect(() => {
    if (pricing.data) {
      setModes(Object.fromEntries(pricing.data.modes.map((m) => [m.key, m.credits])));
      setAddons(Object.fromEntries(pricing.data.addons.map((a) => [a.key, a.credits])));
    }
  }, [pricing.data]);

  async function onSave() {
    try {
      await save.mutateAsync({ templateId, body: { modes, addons } });
      notifications.show({ message: `Pricing saved for ${templateId}`, color: 'teal' });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  if (pricing.isLoading) return <Card padding="lg"><Loader size="sm" /></Card>;
  if (pricing.error) return <Card padding="lg"><Alert color="red">{(pricing.error as Error).message}</Alert></Card>;

  const data = pricing.data!;

  return (
    <Card padding="lg">
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={650}>{name}</Text>
          <Mono size="xs" c="dimmed">{templateId}</Mono>
        </div>
        <Button size="compact-sm" onClick={onSave} loading={save.isPending}>Save</Button>
      </Group>

      <Divider label="Report tiers (credits)" labelPosition="left" my="sm" />
      <Group>
        {data.modes.map((m) => (
          <NumberInput
            key={m.key}
            label={m.key}
            description={`default ${m.defaultCredits}`}
            min={1}
            max={1_000_000}
            w={180}
            value={modes[m.key] ?? m.credits}
            onChange={(v) => setModes({ ...modes, [m.key]: typeof v === 'number' ? v : m.credits })}
          />
        ))}
      </Group>

      <Divider label="Add-ons (credits)" labelPosition="left" my="sm" />
      {data.addons.length === 0 ? (
        <Text size="sm" c="dimmed">This model defines no add-ons.</Text>
      ) : (
        <Group align="flex-start">
          {data.addons.map((a) => (
            <NumberInput
              key={a.key}
              label={a.label}
              description={a.description ? `${a.description} · default ${a.defaultCredits}` : `default ${a.defaultCredits}`}
              min={1}
              max={1_000_000}
              w={240}
              value={addons[a.key] ?? a.credits}
              onChange={(v) => setAddons({ ...addons, [a.key]: typeof v === 'number' ? v : a.credits })}
            />
          ))}
        </Group>
      )}
      <Text size="xs" c="dimmed" mt="sm">Add-ons are defined in the model; here you only set their price. Generators ship later.</Text>
    </Card>
  );
}

export function Pricing() {
  const templates = useTemplates();
  return (
    <Stack>
      <PageHeader eyebrow="Billing" title="Pricing" subtitle="Credit cost per model — tiers + add-ons. Overrides the code default, no deploy." />
      {templates.isLoading && <Loader />}
      {templates.error && <Alert color="red">{(templates.error as Error).message}</Alert>}
      {(templates.data?.templates ?? []).map((t) => (
        <PricingCard key={t.id} templateId={t.id} name={t.name} />
      ))}
    </Stack>
  );
}
