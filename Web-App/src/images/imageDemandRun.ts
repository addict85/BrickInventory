import fs from 'node:fs';
import path from 'node:path';
import { reportError } from '../infra/fehler';
import { reasonFor, isKnownMissing, rememberMissing } from './imageMisses';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { JobInterrupted, JobMove, type JobContext } from '../auftraege';
import {
  STAPEL,
  TAKT_MS,
  NOTIZ_GILT_MS,
  rememberUsed,
  reportSetImageLoaded,
  schreibePuffer,
  noteImageDemand,
  deleteExpired,
  setUpImageDemand,
  stopImageDemand,
  requestsJeMinute,
  nimmBildwuensche,
} from './imageDemand';
import { versuche } from '../infra/ergebnis';
import type { ImagesContext } from './context';

/** Über den Proxy angefragte Bilder im BACKGROUND lokal ablegen, samt
 * Vorschau — damit die Anfrage selbst nie auf das CDN wartet. */

/** Abstand zwischen zwei Arbeitsschritten (siehe STAPEL in src/images/imageDemand.ts). */
const DELAY_MIN_MS = 500;
const DELAY_MAX_MS = 1000;

/** Deckel je Takt; der Takt zählt echte Arbeit, sonst liefe er über Hunderte
 * schon vorhandener Bilder unendlich langsam. */
const DURCHGANG_MAX_NOTIZEN = 500;

const RUN_KEY = 'imgqueue_last_run';

/** Fünf Minuten lassen ein kurzes Limit ablaufen; wichtiger ist, dass
 * überhaupt pausiert wird: Stures Weiterfragen verlängert die Sperre. */
const THROTTLE_PAUSE_MS = 5 * 60 * 1000;

function warte(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function pause(): number {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
}

/** Je Satz Dienste statt je Stapel, damit auch der erste Schritt eines Folgestapels
 * Abstand hält. Vor dem ALLERERSTEN Schritt wird nicht gewartet. */
async function pauseBeforeWork(k: ImagesContext): Promise<void> {
  const takt = k.faecher.fach('bildbedarf:letzteArbeit', () => ({ am: 0 }));
  const soll = pause();
  if (takt.am) {
    const seit = k.uhr.jetzt() - takt.am;
    if (seit < soll) await warte(soll - seit);
  }
  takt.am = k.uhr.jetzt();
}

/** Ein Fehlschlag wird gemerkt, sonst kostet jede nicht lesbare Datei bei
 * jedem Durchgang einen vergeblichen Lauf. */
async function createPreview(k: ImagesContext, relPath: string, schluessel: string): Promise<boolean> {
  if (isKnownMissing(k, 'thumb:' + schluessel)) return false;
  // Auch ein Fehler wird gemerkt: Die Datei käme sonst bei jedem Durchgang wieder.
  const r = await versuche('bild-job:vorschauErzeugenAus', () => k.bildwerk.createPreview(relPath));
  const ok = r.ok && !!r.wert;
  if (!ok) rememberMissing(k, 'thumb:' + schluessel, 'Vorschau konnte nicht erzeugt werden');
  return ok;
}

/** Mehrere Zähler statt einer Zahl, damit das Log zeigt, welcher Ausgang
 * genommen wurde. */
export type StackResult = {
  geholt: number;
  vorschau: number;
  uebersprungen: number;
  gesamt: number;
  /** Jeder Weg durch die Schleife erhöht einen Zähler, damit die Summe aufgeht. */
  notLoaded: number;
  noPreview: number;
  knownMissing: number;
  ohneNummer: number;
  setAside: number;
  /** Bild liegt da, der Eintrag im Katalog scheiterte: Die Oberfläche geht weiter über den Proxy. */
  withoutEntry?: number;
  /** Downloads und Verkleinerungen, NICHT angefasste Notizen: Der Takt
   * entscheidet daran, ob er noch einen Stapel nachholt. */
  work: number;
};

/** Eine Stelle, damit kein Zähler beim Ergänzen vergessen wird. */
function emptyResult(): StackResult {
  return {
    geholt: 0,
    vorschau: 0,
    uebersprungen: 0,
    gesamt: 0,
    notLoaded: 0,
    noPreview: 0,
    knownMissing: 0,
    ohneNummer: 0,
    setAside: 0,
    work: 0,
  };
}

/** Nur was NICHT null ist — sonst geht die eine wichtige Zahl in Nullen unter. */
export function meldung(e: StackResult): string {
  const teile = [`${e.geholt} geladen`, `${e.vorschau} Vorschau erzeugt`, `${e.uebersprungen} bereits vorhanden`];
  if (e.notLoaded) teile.push(`${e.notLoaded} Download fehlgeschlagen`);
  if (e.noPreview) teile.push(`${e.noPreview} Vorschau fehlgeschlagen`);
  if (e.knownMissing) teile.push(`${e.knownMissing} als fehlend bekannt`);
  if (e.ohneNummer) teile.push(`${e.ohneNummer} ohne Setnummer`);
  if (e.setAside) teile.push(`${e.setAside} zurückgelegt`);
  if (e.withoutEntry) teile.push(`${e.withoutEntry} ohne Katalogeintrag`);
  return `${e.gesamt} bearbeitet: ${teile.join(', ')}`;
}

/** Auch in der Datenbank, weil die Kachel in einem anderen Prozess liest. */
export const letzterLauf: { zeit: number | null; ergebnis: StackResult | null } = { zeit: null, ergebnis: null };

function rememberRun(k: ImagesContext, erg: StackResult): void {
  letzterLauf.zeit = k.uhr.jetzt();
  letzterLauf.ergebnis = erg;
}

/** Einmal je Takt, nicht je Stapel: Die Kachel liest Minuten, und eine SD-Karte schont das. */
async function saveRun(k: ImagesContext, erg: StackResult): Promise<void> {
  // await: Der nächste Takt liest den Stand über einen ANDEREN Prozess; ohne await meldete die Kachel „noch
  // nicht gelaufen".
  await k.auftraege
    .setzeZustand(RUN_KEY, JSON.stringify({ zeit: k.uhr.jetzt(), ergebnis: erg }))
    .catch(e => reportError('bild-job:setzeZustand', e));
}

/** Ein 404 vom CDN braucht keine Aufmerksamkeit, alles andere schon (somethingToDo). */
type StackStatus = { erg: StackResult; reasons: string[]; somethingToDo: boolean; work: number };

/** Die Datei ist da, höchstens die Vorschau fehlt. Bekannt gescheiterte nicht
 * anfassen: Jedes webp-Bild kostete sonst bei JEDEM Durchgang einen Lauf. */
async function onlyPreview(k: ImagesContext, setNummer: string, vorschau: string, st: StackStatus): Promise<void> {
  if (fs.existsSync(vorschau)) {
    st.erg.uebersprungen++;
    return;
  }
  if (isKnownMissing(k, 'thumb:' + vorschau)) {
    st.erg.knownMissing++;
    return;
  }
  // Auch hier warten: Eine Verkleinerung kostet mehr als ein Download.
  await pauseBeforeWork(k);
  st.work++;
  if (await createPreview(k, `/images/sets/${setNummer}.jpg`, vorschau)) {
    st.erg.vorschau++;
    return;
  }
  st.erg.noPreview++;
  st.somethingToDo = true;
  st.reasons.push(`${setNummer}: Vorschau fehlgeschlagen`);
}

/** @returns true, wenn das CDN drosselt und der Stapel abbricht */
async function afterFailure(
  k: ImagesContext,
  setNummer: string,
  info: { status?: number },
  st: StackStatus,
): Promise<boolean> {
  const status = info.status;
  // Eine Drosselung ist KEINE Fehlanzeige: Die Bilder gibt es, und stures Weiterfragen verlängert die Sperre.
  if (status === 403 || status === 429) {
    const bis = new Date(k.uhr.jetzt() + THROTTLE_PAUSE_MS);
    await k.auftraege.pauseKind('bildbedarf', bis, `CDN drosselt (HTTP ${status})`);
    console.error(`[image-queue] CDN drosselt (HTTP ${status}) — Pause bis ${bis.toLocaleTimeString()}`);
    return true;
  }
  // NUR ein 404/410 heisst „das Bild gibt es nicht"; Zeitüberschreitungen und Netzaussetzer dürfen ein Bild
  // nicht dauerhaft sperren.
  const hartMissing = info.status === 404 || info.status === 410;
  if (hartMissing) rememberMissing(k, 'set:' + setNummer, `HTTP ${status} vom CDN`);
  else st.somethingToDo = true;
  st.erg.notLoaded++;
  st.reasons.push(
    `${setNummer}: Download fehlgeschlagen` +
      (status ? ` (HTTP ${status})` : ' (kein Statuscode — vorübergehend?)') +
      (hartMissing ? '' : ', wird erneut versucht'),
  );
  return false;
}

async function workStack(k: ImagesContext): Promise<StackResult> {
  const erg = emptyResult();
  const pause = await k.auftraege.liesPause('bildbedarf');
  if (pause && new Date(pause.until_at).getTime() > k.uhr.jetzt()) return erg; // CDN hat gedrosselt, siehe unten
  const rows = await nimmBildwuensche(k, NOTIZ_GILT_MS, STAPEL);
  if (!rows.length) {
    rememberRun(k, erg);
    return erg;
  }

  const st: StackStatus = { erg, reasons: [], somethingToDo: false, work: 0 };
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]!;
    if (!r.set_number) {
      erg.ohneNummer++;
      continue;
    } // ohne Setnummer kein Ablageort

    // Die Dateiprüfung steht hier und nicht beim Einreihen: 25 000 Dateizugriffe in einer Anfrage blockierten
    // schwache Hardware.
    const datei = path.join(SET_IMAGES_DIR, `${r.set_number}.jpg`);
    const vorschau = path.join(SET_IMAGES_DIR, `${r.set_number}_thumb.jpg`);
    if (fs.existsSync(datei)) {
      // kein zweiter Download
      await onlyPreview(k, r.set_number, vorschau, st);
      if (!(await reportSetImageLoaded(k, r.set_number, r.url))) erg.withoutEntry = (erg.withoutEntry ?? 0) + 1;
      continue;
    }

    // Bekannt fehlende Bilder nicht erst holen, wie der Knopf „Katalogbilder holen" auch.
    if (isKnownMissing(k, 'set:' + r.set_number)) {
      erg.knownMissing++;
      // Den Namen nennen: Ohne Setnummer führt kein Weg zu image-diag.
      st.reasons.push(
        `${r.set_number}: als fehlend bekannt` +
          (reasonFor(k, 'set:' + r.set_number) ? ` (${reasonFor(k, 'set:' + r.set_number)})` : ''),
      );
      continue;
    }

    // Die Pause steht ZWISCHEN zwei Anfragen ans CDN — nicht vor der ersten und nicht für Sets, deren Datei
    // schon da ist.
    await pauseBeforeWork(k);
    st.work++;

    const info: { status?: number } = {};
    // Ein Fehler zählt wie ein vergeblicher Abruf; über die Wiederholung entscheidet afterFailure().
    const abruf = await versuche('bild-job:setBildHerunterladen', k.bildwerk.setBildLaden(r.url, r.set_number, info));
    const lokal = abruf.ok ? abruf.wert : null;
    if (!lokal) {
      if (await afterFailure(k, r.set_number, info, st)) {
        // ALLE unbearbeiteten Notizen zurücklegen: Der Stapel kam per DELETE … RETURNING, der Rest wäre sonst
        // still verloren.
        const rest = rows.slice(idx);
        await noteImageDemand(
          k,
          rest.map(x => x.url),
          rest.map(x => x.set_number),
        ); // Scheitert das Zurücklegen, wirft es: Der Auftrag scheitert sichtbar statt still Notizen zu verlieren.
        erg.setAside = rest.length;
        break;
      }
      continue;
    }
    // Die Vorschau entsteht NICHT in setBildHerunterladen(); ohne diesen Aufruf bliebe es bei der grossen
    // Originaldatei.
    await createPreview(k, lokal, vorschau);
    // Erst der Eintrag lässt die Oberfläche die Datei statt des Proxys laden.
    if (!(await reportSetImageLoaded(k, r.set_number, r.url))) erg.withoutEntry = (erg.withoutEntry ?? 0) + 1;
    erg.geholt++;
  }
  // Zurückgelegte Zeilen sind NICHT bearbeitet.
  erg.gesamt = rows.length - erg.setAside;
  erg.work = st.work;
  const { reasons, somethingToDo } = st;
  // Bei wenigen Fällen beim Namen: Mit der Setnummer beantwortet GET /api/v1/admin/image-diag/:setNumber die
  // Frage in einer Antwort.
  if (reasons.length && reasons.length <= 5) {
    (somethingToDo ? console.error : console.warn)(`[image-queue] ${reasons.join(' · ')}`);
  }
  // Hier festhalten: Wer den Stapel ausführt, hat gearbeitet, gleich von wo gerufen. In die Datenbank
  // schreibt erst der Takt.
  rememberRun(k, erg);
  return erg;
}

/** Der Abbruch hängt an echter Arbeit, nicht an angefassten Notizen. */
async function tickPass(k: ImagesContext): Promise<StackResult> {
  const summe = emptyResult();
  while (summe.gesamt < DURCHGANG_MAX_NOTIZEN && summe.work < STAPEL) {
    const e = await workStack(k);
    summe.geholt += e.geholt;
    summe.vorschau += e.vorschau;
    summe.uebersprungen += e.uebersprungen;
    summe.gesamt += e.gesamt;
    summe.work += e.work;
    summe.notLoaded += e.notLoaded;
    summe.noPreview += e.noPreview;
    summe.knownMissing += e.knownMissing;
    summe.ohneNummer += e.ohneNummer;
    summe.setAside += e.setAside;
    if (e.withoutEntry) summe.withoutEntry = (summe.withoutEntry ?? 0) + e.withoutEntry;
    if (!e.gesamt) break;
  }
  // Auch ein Takt, der nichts vorfand, ist ein Lebenszeichen für die Kachel.
  await saveRun(k, summe);
  return summe;
}

/** Drosselt das CDN, geht der Auftrag bis zum Ende der Pause zurück in die Tabelle. */
export async function processImageDemand(kx: ImagesContext, k: JobContext): Promise<void> {
  await schreibePuffer(kx);
  for (;;) {
    if (k.beendet) throw new JobInterrupted();
    const e = await tickPass(kx);
    if (e.gesamt || e.setAside) console.log(`[image-queue] ${meldung(e)}`);
    const pause = await kx.auftraege.liesPause('bildbedarf');
    if (pause && new Date(pause.until_at).getTime() > kx.uhr.jetzt())
      throw new JobMove(new Date(pause.until_at), pause.reason ?? 'CDN drosselt');
    if (!e.gesamt) return;
    if (!(await k.fortschritt({ text: meldung(e) }))) return; // abgebrochen
    await warte(TAKT_MS);
  }
}

export { rememberUsed, setUpImageDemand, stopImageDemand, requestsJeMinute, STAPEL, TAKT_MS, DURCHGANG_MAX_NOTIZEN };

export {
  workStack as _workStack,
  tickPass as _tickPass,
  deleteExpired as _deleteExpired,
  schreibePuffer as _writeBuffer,
};
