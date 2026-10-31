/** Web-Oberfläche und App lesen dieselbe Antwort. */
import { liesZustand } from './repository/laufzustand';
import { AUFTRAGS_ARTEN, type AuftragsArt } from './auftraege';
import { zieheVor, leereArt, wiederhole, brichAb, beendePause } from './dienst';
import * as repo from './repository/auftraege';
import { hatZeitplan, planeNaechsten, ziehePlanVor } from './zeitplan';
import { leereBildbedarf, offenerBildbedarf } from '../katalog/bilder/bildbedarf';
import { fehlerWerfen } from '../infra/fehlerTexte';

const LEBENSZEICHEN_GILT_SEK = 120;
const STATUS = ['offen', 'laeuft', 'fehler', 'abgebrochen', 'erledigt'] as const;

function pruefeArt(art: string): AuftragsArt {
  if (!(AUFTRAGS_ARTEN as readonly string[]).includes(art)) fehlerWerfen('unbekannter_job', 400);
  return art as AuftragsArt;
}

/** Nutzlasten bleiben draussen: Sie tragen ganze Listen. */
export async function auftragsUebersicht(filter: { status?: string | undefined; art?: string | undefined } = {}) {
  const status = (filter.status ? filter.status.split(',') : ['offen', 'laeuft', 'fehler', 'abgebrochen'])
    .filter(s => (STATUS as readonly string[]).includes(s));
  const art = filter.art ? pruefeArt(filter.art) : null;
  const [auftraege, zusammenfassung, pausen, lebenszeichen, bildbedarf] = await Promise.all([
    repo.auftragsListe(status, art),
    repo.zahlenJeArtUndStatus(),
    repo.laufendePausen(),
    liesZustand('jobs_lebenszeichen'),
    offenerBildbedarf(),
  ]);
  const alterSek = lebenszeichen ? Math.round((Date.now() - new Date(lebenszeichen).getTime()) / 1000) : null;
  return {
    success: true,
    auftraege, zusammenfassung, pausen, bildbedarf,
    job_prozess: { lebenszeichen, alter_sekunden: alterSek, laeuft: alterSek !== null && alterSek < LEBENSZEICHEN_GILT_SEK },
  };
}

/** Bei einer geplanten Art steht danach der nächste reguläre Termin an. */
export async function auftragAbbrechen(id: string) {
  const a = await brichAb(id);
  if (!a) fehlerWerfen('auftrag_nicht_aenderbar', 409);
  if (hatZeitplan(a.art)) await planeNaechsten(a.art);
  return { success: true, id, status: 'abgebrochen' };
}

export async function auftragWiederholen(id: string) {
  if (!await wiederhole(id)) fehlerWerfen('auftrag_nicht_aenderbar', 409);
  return { success: true, id, status: 'offen' };
}

/** Geplante Termine bleiben; beim Bildbedarf gehen auch die Notizen. */
export async function auftragsArtLeeren(artRoh: string) {
  const art = pruefeArt(artRoh);
  const entfernt = await leereArt(art) + (art === 'bildbedarf' ? await leereBildbedarf() : 0);
  return { success: true, art, entfernt };
}

export async function auftragsArtJetzt(artRoh: string) {
  const art = pruefeArt(artRoh);
  await beendePause(art);
  const gestartet = hatZeitplan(art) ? await ziehePlanVor(art) : (await zieheVor(art)) > 0;
  return { success: true, art, gestartet };
}
