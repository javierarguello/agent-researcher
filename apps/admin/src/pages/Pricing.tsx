import { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Button, Card, Divider, Group, Loader, NumberInput, Stack, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { usePricing, useSetPricing, useTemplates } from '../api/hooks';
import { ApiError } from '../api/client';

interface AddonRow {
  key: string;
  credits: number | '';
}

function PricingCard({ templateId, name }: { templateId: string; name: string }) {
  const pricing = usePricing(templateId);
  const save = useSetPricing();
  const [modes, setModes] = useState<Record<string, number>>({});
  const [addons, setAddons] = useState<AddonRow[]>([]);

  useEffect(() => {
    if (pricing.data) {
      setModes(Object.fromEntries(pricing.data.modes.map((m) => [m.key, m.credits])));
      setAddons(Object.entries(pricing.data.addons).map(([key, credits]) => ({ key, credits })));
    }
  }, [pricing.data]);

  async function onSave() {
    const addonMap: Record<string, number> = {};
    for (const r of addons) {
      const k = r.key.trim();
      if (k && typeof r.credits === 'number' && r.credits > 0) addonMap[k] = r.credits;
    }
    try {
      await save.mutateAsync({ templateId, body: { modes, addons: addonMap } });
      notifications.show({ message: `Pricing saved for ${templateId}`, color: 'teal' });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  if (pricing.isLoading) return <Card padding="lg"><Loader size="sm" /></Card>;
  if (pricing.error) return <Card padding="lg"><Alert color="red">{(pricing.error as Error).message}</Alert></Card>;

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
        {(pricing.data?.modes ?? []).map((m) => (
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
      <Stack gap="xs">
        {addons.map((r, i) => (
          <Group key={i} gap="xs">
            <TextInput
              placeholder="add-on key (e.g. deck)"
              value={r.key}
              onChange={(e) => setAddons(addons.map((x, j) => (j === i ? { ...x, key: e.currentTarget.value } : x)))}
              w={220}
            />
            <NumberInput
              placeholder="credits"
              min={1}
              max={1_000_000}
              w={120}
              value={r.credits}
              onChange={(v) => setAddons(addons.map((x, j) => (j === i ? { ...x, credits: typeof v === 'number' ? v : '' } : x)))}
            />
            <ActionIcon variant="subtle" color="red" onClick={() => setAddons(addons.filter((_, j) => j !== i))}>✕</ActionIcon>
          </Group>
        ))}
        <Button size="compact-sm" variant="light" w={140} onClick={() => setAddons([...addons, { key: '', credits: '' }])}>
          + Add-on
        </Button>
        <Text size="xs" c="dimmed">Add-on generators are built later; prices set here already apply when they ship.</Text>
      </Stack>
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
