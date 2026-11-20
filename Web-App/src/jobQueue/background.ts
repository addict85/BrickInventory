/** Web UI and app read the same response. */
import type { JobKind } from './jobs';
import { pullBefore, repeat, abortAb, endPause } from './service';
import { hatSchedule, planeNext, pullPlanBefore } from './schedule';
import { fachfehler } from '../infra/errorTexts';
import type { JobsContext } from './context';

const HEARTBEAT_APPLIES_SEC = 120;
const STATUS = ['offen', 'laeuft', 'fehler', 'abgebrochen', 'erledigt'] as const;

function checkKind(k: JobsContext, art: string): JobKind {
  if (!k.arten.von(art)) fachfehler('ungueltig', 'unbekannter_job');
  return art as JobKind;
}

/** Payloads stay outside: they carry whole lists. Without a filter only what
 * is still pending; the summary counts failed ones per kind. */
export async function jobsInOverview(
  k: JobsContext,
  filter: { status?: string | undefined; art?: string | undefined } = {},
) {
  const status = (filter.status ? filter.status.split(',') : ['offen', 'laeuft']).filter(s =>
    (STATUS as readonly string[]).includes(s),
  );
  const art = filter.art ? checkKind(k, filter.art) : null;
  const [auftraege, zusammenfassung, pausen, lebenszeichen] = await Promise.all([
    k.auftraege.jobList(status, art),
    k.auftraege.numbersJeKindAndStatus(),
    k.auftraege.runningPauses(),
    k.laufzustand.liesZustand('jobs_lebenszeichen'),
  ]);
  const alterSec = lebenszeichen ? Math.round((k.uhr.jetzt() - new Date(lebenszeichen).getTime()) / 1000) : null;
  return {
    auftraege,
    zusammenfassung,
    pausen,
    job_prozess: {
      lebenszeichen,
      alter_sekunden: alterSec,
      laeuft: alterSec !== null && alterSec < HEARTBEAT_APPLIES_SEC,
    },
  };
}

/** For a scheduled kind the next regular appointment is pending afterwards. */
export async function auftragAbbrechen(k: JobsContext, kennung: number) {
  // The response names the identifier as text like the overview (bigint).
  const id = String(kennung);
  const a = await abortAb(k, id);
  if (!a) fachfehler('konflikt', 'auftrag_nicht_aenderbar');
  await planeNext(k, a.type);
  return { id, status: 'abgebrochen' };
}

export async function retryJob(k: JobsContext, kennung: number) {
  const id = String(kennung);
  if (!(await repeat(k, id))) fachfehler('konflikt', 'auftrag_nicht_aenderbar');
  return { id, status: 'offen' };
}

/** Scheduled appointments stay. */
export async function emptyJobKind(k: JobsContext, kindRaw: string) {
  const art = checkKind(k, kindRaw);
  return { art, entfernt: await k.auftraege.emptyKind(art) };
}

export async function auftragsArtJetzt(k: JobsContext, kindRaw: string) {
  const art = checkKind(k, kindRaw);
  await endPause(k, art);
  const gestartet = hatSchedule(k, art) ? await pullPlanBefore(k, art) : (await pullBefore(k, art)) > 0;
  return { art, gestartet };
}
