/** Web-Oberfläche und App lesen dieselbe Antwort. */
import { AUFTRAGS_ARTEN, type AuftragsArt } from './auftraege';
import { zieheVor, wiederhole, brichAb, beendePause } from './dienst';
import { hatZeitplan, planeNaechsten, ziehePlanVor } from './zeitplan';
import { fachfehler } from '../infra/fehlerTexte';
import { auftraegeBereich } from './prozess';

const LEBENSZEICHEN_GILT_SEK = 120;
const STATUS = ['offen', 'laeuft', 'fehler', 'abgebrochen', 'erledigt'] as const;

function pruefeArt(art: string): AuftragsArt {
  if (!(AUFTRAGS_ARTEN as readonly string[]).includes(art)) fachfehler('ungueltig', 'unbekannter_job');
  return art as AuftragsArt;
}

/** Nutzlasten bleiben draussen: Sie tragen ganze Listen. */
export async function auftraegeImUeberblick(filter: { status?: string | undefined; art?: string | undefined } = {}) {
  const status = (filter.status ? filter.status.split(',') : ['offen', 'laeuft', 'fehler', 'abgebrochen']).filter(s =>
    (STATUS as readonly string[]).includes(s),
  );
  const art = filter.art ? pruefeArt(filter.art) : null;
  const [auftraege, zusammenfassung, pausen, lebenszeichen] = await Promise.all([
    auftraegeBereich().auftraege.auftragsListe(status, art),
    auftraegeBereich().auftraege.zahlenJeArtUndStatus(),
    auftraegeBereich().auftraege.laufendePausen(),
    auftraegeBereich().laufzustand.liesZustand('jobs_lebenszeichen'),
  ]);
  const alterSek = lebenszeichen ? Math.round((Date.now() - new Date(lebenszeichen).getTime()) / 1000) : null;
  return {
    auftraege,
    zusammenfassung,
    pausen,
    job_prozess: {
      lebenszeichen,
      alter_sekunden: alterSek,
      laeuft: alterSek !== null && alterSek < LEBENSZEICHEN_GILT_SEK,
    },
  };
}

/** Bei einer geplanten Art steht danach der nächste reguläre Termin an. */
export async function auftragAbbrechen(id: string) {
  const a = await brichAb(id);
  if (!a) fachfehler('konflikt', 'auftrag_nicht_aenderbar');
  if (hatZeitplan(a.art)) await planeNaechsten(a.art);
  return { id, status: 'abgebrochen' };
}

export async function auftragWiederholen(id: string) {
  if (!(await wiederhole(id))) fachfehler('konflikt', 'auftrag_nicht_aenderbar');
  return { id, status: 'offen' };
}

/** Geplante Termine bleiben. */
export async function leereAuftragsArt(artRoh: string) {
  const art = pruefeArt(artRoh);
  return { art, entfernt: await auftraegeBereich().auftraege.leereArt(art) };
}

export async function auftragsArtJetzt(artRoh: string) {
  const art = pruefeArt(artRoh);
  await beendePause(art);
  const gestartet = hatZeitplan(art) ? await ziehePlanVor(art) : (await zieheVor(art)) > 0;
  return { art, gestartet };
}
