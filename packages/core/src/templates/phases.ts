/** Engine lifecycle phases (not model-specific) and their localized labels. */

export interface PhaseLabel {
  label: string;
  description?: string;
}

/** Ordered lifecycle steps that bracket the agent workflow. */
export const LIFECYCLE_BEFORE = ['planning'] as const;
export const LIFECYCLE_AFTER = ['assembling', 'done'] as const;
/**
 * Terminal/other phases surfaced for lookup (not part of the linear sequence).
 *
 * `held` belongs here even though it is not terminal: a client looks a phase up by
 * id to label it, and `held` was the ONE phase with no step. So the job page's
 * headline fell back to "Generating your dossier…" under an "Under review" badge,
 * and the inbox row printed the raw English key `held` to a Spanish buyer — on a
 * job that is deliberately long-lived, waiting for a human (round 7, R7-5).
 */
export const LIFECYCLE_OTHER = ['incomplete', 'failed', 'held'] as const;

const EN: Record<string, PhaseLabel> = {
  planning: { label: 'Planning', description: 'Planning the research workflow.' },
  assembling: { label: 'Assembling report', description: 'Composing and validating the final report.' },
  done: { label: 'Complete', description: 'The report is ready.' },
  incomplete: { label: 'Paused', description: 'Some steps are still retrying; the report will resume.' },
  failed: { label: 'Failed', description: 'The report could not be completed.' },
  held: { label: 'Under review', description: 'Someone is checking this dossier before it goes on.' },
};

// "job" is our word, not the buyer's — they bought a report. Fixed here while
// adding the two missing languages rather than translating the leak into two more.
const ES: Record<string, PhaseLabel> = {
  planning: { label: 'Planificando', description: 'Planificando el flujo de investigación.' },
  assembling: { label: 'Ensamblando reporte', description: 'Componiendo y validando el reporte final.' },
  done: { label: 'Completado', description: 'El reporte está listo.' },
  incomplete: { label: 'En pausa', description: 'Algunos pasos siguen reintentando; el reporte se retomará.' },
  failed: { label: 'Falló', description: 'El reporte no pudo completarse.' },
  held: { label: 'En revisión', description: 'Alguien está revisando este dossier antes de continuar.' },
};

const FR: Record<string, PhaseLabel> = {
  planning: { label: 'Planification', description: 'Planification du déroulé de la recherche.' },
  assembling: { label: 'Assemblage du rapport', description: 'Composition et validation du rapport final.' },
  done: { label: 'Terminé', description: 'Le rapport est prêt.' },
  incomplete: { label: 'En pause', description: 'Certaines étapes sont en cours de reprise ; le rapport va se poursuivre.' },
  failed: { label: 'Échec', description: 'Le rapport n’a pas pu être terminé.' },
  held: { label: 'En révision', description: 'Quelqu’un vérifie ce dossier avant la suite.' },
};

const PT: Record<string, PhaseLabel> = {
  planning: { label: 'Planejando', description: 'Planejando o fluxo da pesquisa.' },
  assembling: { label: 'Montando relatório', description: 'Compondo e validando o relatório final.' },
  done: { label: 'Concluído', description: 'O relatório está pronto.' },
  incomplete: { label: 'Em pausa', description: 'Algumas etapas ainda estão sendo repetidas; o relatório será retomado.' },
  failed: { label: 'Falhou', description: 'O relatório não pôde ser concluído.' },
  held: { label: 'Em revisão', description: 'Alguém está revisando este dossiê antes de continuar.' },
};

// All four, because these are the first and last things a buyer watches during the
// wait — and they survive independently of the template's own `i18n` block, so
// translating the template left fr/pt buyers still reading "Planning".
const PHASE_LABELS: Record<string, Record<string, PhaseLabel>> = { en: EN, es: ES, fr: FR, pt: PT };

// `held`'s description is deliberately NOT the `held` progress line: the buyer's
// card renders both, one under the other, and two sentences saying "paused while we
// review it" is what a duplicated string looks like on a screen.

/** Localized label for a lifecycle phase (English fallback). */
export function phaseLabel(phase: string, lang: string): PhaseLabel {
  return PHASE_LABELS[lang]?.[phase] ?? EN[phase] ?? { label: phase };
}
