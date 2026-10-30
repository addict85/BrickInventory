/**
 * Fachdienst „Hintergrundarbeiten" der Verwaltung: die Auftragstabelle lesen,
 * einzelne Aufträge abbrechen oder wiederholen, eine Art leeren oder jetzt
 * fällig machen. Web-Oberfläche und App lesen dieselbe Antwort.
 */
import * as db from '../../db/database';
import { liesZustand } from '../laufzustand';
import { AUFTRAGS_ARTEN, brichAb, leereArt, wiederhole, zieheVor, beendePause, type AuftragsArt } from '../auftraege';
import { hatZeitplan, planeNaechsten, ziehePlanVor } from '../zeitplan';
import { leereBildbedarf, offenerBildbedarf } from '../bildbedarf';
import { fehlerWerfen } from '../fehlerTexte';

/** Ohne Lebenszeichen seit so vielen Sekunden gilt der Job-Prozess als ausgefallen. */
const LEBENSZEICHEN_GILT_SEK = 120;
const STATUS = ['offen', 'laeuft', 'fehler', 'abgebrochen', 'erledigt'] as const;

function pruefeArt(art: string): AuftragsArt {
  if (!(AUFTRAGS_ARTEN as readonly string[]).includes(art)) fehlerWerfen('unbekannter_job', 400);
  return art as AuftragsArt;
}

/**
 * Die Übersicht: höchstens 200 Aufträge (laufende zuerst), die Zahl je Art und
 * Status, laufende Pausen, der offene Bildbedarf und ob ein Job-Prozess lebt.
 * Ohne Filter ohne erledigte; Nutzlasten bleiben draussen (sie tragen ganze Listen).
 */
export async function auftragsUebersicht(filter: { status?: string | undefined; art?: string | undefined } = {}) {
  const status = (filter.status ? filter.status.split(',') : ['offen', 'laeuft', 'fehler', 'abgebrochen'])
    .filter(s => (STATUS as readonly string[]).includes(s));
  const art = filter.art ? pruefeArt(filter.art) : null;
  const [auftraege, zusammenfassung, pausen, lebenszeichen, bildbedarf] = await Promise.all([
    db.all(
      `SELECT id::text AS id, art, status, versuche, max_versuche, faellig_ab, frist_bis, gestartet, erstellt,
              aktualisiert, fortschritt, fehler, user_id, COALESCE(schluessel LIKE 'plan:%', false) AS geplant,
              nutzlast->>'set_number' AS set_number
         FROM auftraege
        WHERE status = ANY($1) AND ($2::text IS NULL OR art = $2)
        ORDER BY CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 1 WHEN 'fehler' THEN 2 ELSE 3 END,
                 faellig_ab, id
        LIMIT 200`, [status, art]),
    db.all(`SELECT art, status, COUNT(*)::int AS anzahl FROM auftraege GROUP BY art, status ORDER BY art, status`),
    db.all(`SELECT art, bis, grund FROM auftrag_pausen WHERE bis > NOW() ORDER BY bis`),
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

/** Abbrechen; bei einer geplanten Art steht danach der nächste reguläre Termin an. */
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

/** Offene Aufträge einer Art verwerfen; geplante Termine bleiben. Beim Bildbedarf auch die Notizen. */
export async function auftragsArtLeeren(artRoh: string) {
  const art = pruefeArt(artRoh);
  const entfernt = await leereArt(art) + (art === 'bildbedarf' ? await leereBildbedarf() : 0);
  return { success: true, art, entfernt };
}

/** Eine Art jetzt fällig machen: den geplanten Lauf vorziehen oder die Wartenden samt Pause. */
export async function auftragsArtJetzt(artRoh: string) {
  const art = pruefeArt(artRoh);
  await beendePause(art);
  const gestartet = hatZeitplan(art) ? await ziehePlanVor(art) : (await zieheVor(art)) > 0;
  return { success: true, art, gestartet };
}
