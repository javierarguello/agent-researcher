/**
 * The live progress line, in the reader's language.
 *
 * The engine's `message` is its own English sentence — `Writing (market_overview,
 * competitive_landscape).` — and it used to be printed raw under the step label,
 * whatever language the buyer bought in, and whatever a web page had talked the
 * model into searching for. The API now hands this client the KIND of step and,
 * for a search, the query; this table turns the kind into a sentence and shows the
 * query the one way it cannot be mistaken for something we said: quoted, as the
 * thing being searched for.
 */
import type { Lang } from '../i18n';
import type { ProgressKind } from '../api/types';

type Copy = Record<Lang, string>;

const KIND: Record<ProgressKind, Copy> = {
  starting: { en: 'Starting the research.', es: 'Iniciando la investigación.', fr: 'Démarrage de la recherche.', pt: 'Iniciando a pesquisa.' },
  wave: { en: 'Starting the next group of analysts.', es: 'Iniciando el siguiente grupo de analistas.', fr: 'Lancement du groupe d’analystes suivant.', pt: 'Iniciando o próximo grupo de analistas.' },
  researching: { en: 'Researching.', es: 'Investigando.', fr: 'Recherche en cours.', pt: 'Pesquisando.' },
  reusing: { en: 'Reusing evidence already gathered.', es: 'Reutilizando evidencia ya recopilada.', fr: 'Réutilisation des éléments déjà rassemblés.', pt: 'Reutilizando evidências já reunidas.' },
  plan: { en: 'Planning the next steps.', es: 'Planificando los siguientes pasos.', fr: 'Planification des prochaines étapes.', pt: 'Planejando os próximos passos.' },
  searched: { en: 'Searching for', es: 'Buscando', fr: 'Recherche de', pt: 'Pesquisando' },
  search_failed: { en: 'A search did not go through; retrying.', es: 'Una búsqueda no respondió; reintentando.', fr: 'Une recherche n’a pas abouti ; nouvel essai.', pt: 'Uma busca não respondeu; tentando de novo.' },
  fetched: { en: 'Reading a source in full.', es: 'Leyendo una fuente completa.', fr: 'Lecture d’une source en entier.', pt: 'Lendo uma fonte na íntegra.' },
  cached: { en: 'Re-reading a source already gathered.', es: 'Releyendo una fuente ya recopilada.', fr: 'Relecture d’une source déjà rassemblée.', pt: 'Relendo uma fonte já reunida.' },
  stopped: { en: 'Research for this step is complete.', es: 'La investigación de este paso está completa.', fr: 'La recherche de cette étape est terminée.', pt: 'A pesquisa desta etapa está concluída.' },
  ceiling: { en: 'Pausing this step for review.', es: 'Pausando este paso para revisión.', fr: 'Mise en pause de cette étape pour révision.', pt: 'Pausando esta etapa para revisão.' },
  writing: { en: 'Writing this section.', es: 'Redactando esta sección.', fr: 'Rédaction de cette section.', pt: 'Redigindo esta seção.' },
  composing: { en: 'Composing this section from the findings.', es: 'Componiendo esta sección a partir de los hallazgos.', fr: 'Composition de cette section à partir des résultats.', pt: 'Compondo esta seção a partir dos achados.' },
  retry: { en: 'Retrying this step.', es: 'Reintentando este paso.', fr: 'Nouvel essai de cette étape.', pt: 'Tentando esta etapa novamente.' },
  failed: { en: 'This step could not be completed.', es: 'Este paso no pudo completarse.', fr: 'Cette étape n’a pas pu être terminée.', pt: 'Esta etapa não pôde ser concluída.' },
  assembling: { en: 'Assembling the report.', es: 'Ensamblando el reporte.', fr: 'Assemblage du rapport.', pt: 'Montando o relatório.' },
  done: { en: 'Report complete.', es: 'Reporte completo.', fr: 'Rapport terminé.', pt: 'Relatório concluído.' },
  held: { en: 'Paused while we review it. Nothing more is being spent, and we will get back to you.', es: 'En pausa mientras lo revisamos. No se gasta nada más y te avisaremos.', fr: 'En pause pendant que nous l’examinons. Rien de plus n’est dépensé, et nous revenons vers vous.', pt: 'Em pausa enquanto revisamos. Nada mais está sendo gasto e voltaremos a você.' },
  incomplete: { en: 'Some steps are still pending; they will resume shortly.', es: 'Algunos pasos siguen pendientes; se retomarán en breve.', fr: 'Certaines étapes sont encore en attente ; elles reprendront sous peu.', pt: 'Alguns passos ainda estão pendentes; serão retomados em breve.' },
};

/**
 * The line to print, or null when there is nothing localizable (a job written
 * before `kind` existed — the step label above it still says where we are).
 */
export function progressLine(progress: { kind?: ProgressKind; detail?: string } | null | undefined, lang: Lang): string | null {
  if (!progress?.kind) return null;
  const copy = KIND[progress.kind];
  if (!copy) return null;
  const base = copy[lang] ?? copy.en;
  if (progress.kind === 'searched') {
    // The query is the model's, written after reading web pages. Quoted and
    // introduced as what is being searched for, so it reads as a query and not
    // as a message from us; the API clips it before it gets here.
    return progress.detail ? `${base} “${progress.detail}”` : `${base}…`;
  }
  return base;
}
