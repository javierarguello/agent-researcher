/** Engine lifecycle phases (not model-specific) and their localized labels. */

export interface PhaseLabel {
  label: string;
  description?: string;
}

/** Ordered lifecycle steps that bracket the agent workflow. */
export const LIFECYCLE_BEFORE = ['planning'] as const;
export const LIFECYCLE_AFTER = ['assembling', 'done'] as const;
/** Terminal/other phases surfaced for lookup (not part of the linear sequence). */
export const LIFECYCLE_OTHER = ['incomplete', 'failed'] as const;

const EN: Record<string, PhaseLabel> = {
  planning: { label: 'Planning', description: 'Planning the research workflow.' },
  assembling: { label: 'Assembling report', description: 'Composing and validating the final report.' },
  done: { label: 'Complete', description: 'The report is ready.' },
  incomplete: { label: 'Paused', description: 'Some steps are still retrying; the job will resume.' },
  failed: { label: 'Failed', description: 'The job could not be completed.' },
};

const ES: Record<string, PhaseLabel> = {
  planning: { label: 'Planificando', description: 'Planificando el flujo de investigación.' },
  assembling: { label: 'Ensamblando reporte', description: 'Componiendo y validando el reporte final.' },
  done: { label: 'Completado', description: 'El reporte está listo.' },
  incomplete: { label: 'En pausa', description: 'Algunos pasos siguen reintentando; el job se reanudará.' },
  failed: { label: 'Falló', description: 'El job no pudo completarse.' },
};

const PHASE_LABELS: Record<string, Record<string, PhaseLabel>> = { en: EN, es: ES };

/** Localized label for a lifecycle phase (English fallback). */
export function phaseLabel(phase: string, lang: string): PhaseLabel {
  return PHASE_LABELS[lang]?.[phase] ?? EN[phase] ?? { label: phase };
}
