import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CreditPlan, JobDetail, JobListItem, JobReport, TemplateManifest } from './types';

const LIVE = new Set(['queued', 'running', 'incomplete']);

export function useTemplates(lang: string) {
  return useQuery({ queryKey: ['templates', lang], queryFn: () => api<{ templates: TemplateManifest[] }>(`/templates?lang=${lang}`), staleTime: 5 * 60_000 });
}
export function useTemplate(id: string | null, lang: string) {
  return useQuery({ queryKey: ['template', id, lang], enabled: !!id, queryFn: () => api<TemplateManifest>(`/templates/${encodeURIComponent(id!)}?lang=${lang}`), staleTime: 5 * 60_000 });
}
export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<{ jobs: JobListItem[] }>('/research'),
    // Poll while any job is live so the dashboard shows the current step in real time.
    refetchInterval: (q) => ((q.state.data as { jobs: JobListItem[] } | undefined)?.jobs.some((j) => LIVE.has(j.status)) ? 5000 : false),
  });
}
export function useJob(jobId: string) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api<JobDetail>(`/research/${encodeURIComponent(jobId)}`),
    refetchInterval: (q) => (LIVE.has((q.state.data as JobDetail | undefined)?.status ?? '') ? 3000 : false),
  });
}
export function useJobReport(jobId: string, enabled: boolean) {
  return useQuery({ queryKey: ['job-report', jobId], enabled, staleTime: Infinity, queryFn: () => api<JobReport>(`/research/${encodeURIComponent(jobId)}/report`) });
}
export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { template: string; params: Record<string, unknown> }) => api<{ jobId: string; status: string }>('/research', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
export interface PreflightIssue { code: string; message: string; severity: 'info' | 'warn'; field?: string }
export interface PreflightCorrection { field: string; from: string; to: string }
export interface PreflightResult {
  ok: boolean;
  /** Plain-language description of what will be researched, rendered by the API
   *  from the params themselves (never written by a model). */
  summary: string;
  quality: 'ok' | 'broad' | 'ambiguous';
  /** Findings, each with copy the API owns — safe to render as text. */
  issues: PreflightIssue[];
  /** Proposed fixes, shown as a diff; applying them is the user's choice. */
  corrections: PreflightCorrection[];
  /** The params with every proposed fix applied — submit these to accept them. */
  correctedParams?: Record<string, unknown>;
  /** Whether the assisted (AI) layer ran, and why not when it didn't. */
  assist: { state: 'on' | 'off_disabled' | 'off_no_credits' | 'off_cooldown'; message?: string };
}
/** Pre-flight review: moderation + a deterministic summary + an optional assisted pass. */
export function usePreflight() {
  return useMutation({
    mutationFn: (body: { template: string; params: Record<string, unknown> }) => api<PreflightResult>('/research/preflight', { method: 'POST', body }),
  });
}
export function useBalance() {
  return useQuery({ queryKey: ['balance'], queryFn: () => api<{ balance: number }>('/credits/balance') });
}
export interface MyStats { total: number; ready: number; inProgress: number; failed: number; blocked?: boolean; blockedReason?: string | null }
/** Per-user report counters (server-side aggregate over ALL jobs), for the dashboard tiles. */
export function useMyStats() {
  return useQuery({ queryKey: ['my-stats'], queryFn: () => api<MyStats>('/me/stats'), refetchInterval: 15000 });
}
export function usePlans(lang: string) {
  return useQuery({ queryKey: ['plans', lang], queryFn: () => api<{ plans: CreditPlan[] }>(`/credits/plans?lang=${lang}`) });
}
/** Public plans (no auth) for the landing pricing section — straight from Stripe via the API, localized. */
export function usePublicPlans(appId: string, lang: string) {
  return useQuery({ queryKey: ['public-plans', appId, lang], staleTime: 5 * 60_000, queryFn: () => api<{ plans: CreditPlan[] }>(`/plans?appId=${encodeURIComponent(appId)}&lang=${lang}`, { anonymous: true }) });
}
export function useCheckout() {
  return useMutation({
    mutationFn: (body: { planId: string; successUrl: string; cancelUrl: string }) => api<{ url: string }>('/credits/checkout', { method: 'POST', body }),
  });
}
