import fs from 'node:fs';
import path from 'node:path';
import { logAndContinue } from '../../infra/fehler';
import { downloadSetImage } from './setImages';
import { setBildLokalEintragen } from '../bildlage';
import { grundFuer, istBekanntFehlend, merkeFehlend } from './imageMisses';
import { generateThumb } from './thumbs';
import { SET_IMAGES_DIR } from '../../infra/appPaths';
import { auftraegeBereich, AuftragUnterbrochen, AuftragVerschieben, type AuftragsKontext } from '../../auftraege';
import {
  STAPEL,
  TAKT_MS,
  NOTIZ_GILT_MS,
  merkeGebraucht,
  schreibePuffer,
  notiereBildbedarf,
  loescheVerfallene,
  initImageQueue,
  stoppeBildbedarf,
  anfragenJeMinute,
  nimmBildwuensche,
} from './bildbedarf';
import { versuche } from '../../infra/ergebnis';

/** Über den Proxy angefragte Bilder im HINTERGRUND lokal ablegen, samt
 * Vorschau — damit die Anfrage selbst nie auf das CDN wartet. */

/** Abstand zwischen zwei Arbeitsschritten (siehe STAPEL in src/katalog/bilder/bildbedarf.ts). */
const VERZOEGERUNG_MIN_MS = 500;
const VERZOEGERUNG_MAX_MS = 1000;

/** Deckel je Takt; der Takt zählt echte Arbeit, sonst liefe er über Hunderte
 * schon vorhandener Bilder unendlich langsam. */
const DURCHGANG_MAX_NOTIZEN = 500;

const LAUF_SCHLUESSEL = 'imgqueue_last_run';

/** Fünf Minuten lassen ein kurzes Limit ablaufen; wichtiger ist, dass
 * überhaupt pausiert wird: Stures Weiterfragen verlängert die Sperre. */
const DROSSEL_PAUSE_MS = 5 * 60 * 1000;

function warte(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function pause(): number {
  return VERZOEGERUNG_MIN_MS + Math.floor(Math.random() * (VERZOEGERUNG_MAX_MS - VERZOEGERUNG_MIN_MS));
}

/** Modulweit statt je Stapel, damit auch der erste Schritt eines Folgestapels
 * Abstand hält; prozesslokal, weil er DIESEN Prozess drosselt. */
let _letzteArbeit = 0;

/** Vor dem ALLERERSTEN Schritt wird nicht gewartet — der Ablauf soll nicht künstlich später beginnen. */
async function pauseVorArbeit(): Promise<void> {
  const soll = pause();
  if (_letzteArbeit) {
    const seit = Date.now() - _letzteArbeit;
    if (seit < soll) await warte(soll - seit);
  }
  _letzteArbeit = Date.now();
}

/** Ein Fehlschlag wird gemerkt, sonst kostet jede nicht lesbare Datei bei
 * jedem Durchgang einen vergeblichen Lauf. */
async function vorschauErzeugen(relPfad: string, schluessel: string): Promise<boolean> {
  if (istBekanntFehlend('thumb:' + schluessel)) return false;
  // Auch ein Fehler wird gemerkt: Die Datei käme sonst bei jedem Durchgang wieder.
  const r = await versuche('bild-job:generateThumb', () => generateThumb(relPfad));
  const ok = r.ok && !!r.wert;
  if (!ok) merkeFehlend('thumb:' + schluessel, 'Vorschau konnte nicht erzeugt werden');
  return ok;
}

/** Mehrere Zähler statt einer Zahl, damit das Log zeigt, welcher Ausgang
 * genommen wurde. */
export type StapelErgebnis = {
  geholt: number;
  vorschau: number;
  uebersprungen: number;
  gesamt: number;
  /** Jeder Weg durch die Schleife erhöht einen Zähler, damit die Summe aufgeht. */
  nichtGeladen: number;
  keineVorschau: number;
  bekanntFehlend: number;
  ohneNummer: number;
  zurueckgelegt: number;
  /** Downloads und Verkleinerungen, NICHT angefasste Notizen: Der Takt
   * entscheidet daran, ob er noch einen Stapel nachholt. */
  arbeit: number;
};

/** Eine Stelle, damit kein Zähler beim Ergänzen vergessen wird. */
function leeresErgebnis(): StapelErgebnis {
  return {
    geholt: 0,
    vorschau: 0,
    uebersprungen: 0,
    gesamt: 0,
    nichtGeladen: 0,
    keineVorschau: 0,
    bekanntFehlend: 0,
    ohneNummer: 0,
    zurueckgelegt: 0,
    arbeit: 0,
  };
}

/** Nur was NICHT null ist — sonst geht die eine wichtige Zahl in Nullen unter. */
export function meldung(e: StapelErgebnis): string {
  const teile = [`${e.geholt} geladen`, `${e.vorschau} Vorschau erzeugt`, `${e.uebersprungen} bereits vorhanden`];
  if (e.nichtGeladen) teile.push(`${e.nichtGeladen} Download fehlgeschlagen`);
  if (e.keineVorschau) teile.push(`${e.keineVorschau} Vorschau fehlgeschlagen`);
  if (e.bekanntFehlend) teile.push(`${e.bekanntFehlend} als fehlend bekannt`);
  if (e.ohneNummer) teile.push(`${e.ohneNummer} ohne Setnummer`);
  if (e.zurueckgelegt) teile.push(`${e.zurueckgelegt} zurückgelegt`);
  return `${e.gesamt} bearbeitet: ${teile.join(', ')}`;
}

/** Auch in der Datenbank, weil die Kachel in einem anderen Prozess liest. */
export const letzterLauf: { zeit: number | null; ergebnis: StapelErgebnis | null } = { zeit: null, ergebnis: null };

function merkeLauf(erg: StapelErgebnis): void {
  letzterLauf.zeit = Date.now();
  letzterLauf.ergebnis = erg;
}

/** Einmal je Takt, nicht je Stapel: Die Kachel liest Minuten, und eine SD-Karte schont das. */
async function speichereLauf(erg: StapelErgebnis): Promise<void> {
  // await: Der nächste Takt liest den Stand über einen ANDEREN Prozess; ohne await meldete die Kachel „noch
  // nicht gelaufen".
  await auftraegeBereich()
    .laufzustand.setzeZustand(LAUF_SCHLUESSEL, JSON.stringify({ zeit: Date.now(), ergebnis: erg }))
    .catch(logAndContinue('bild-job:setzeZustand'));
}

/** Ein 404 vom CDN braucht keine Aufmerksamkeit, alles andere schon (etwasZuTun). */
type StapelStand = { erg: StapelErgebnis; gruende: string[]; etwasZuTun: boolean; arbeit: number };

/** Die Datei ist da, höchstens die Vorschau fehlt. Bekannt gescheiterte nicht
 * anfassen: Jedes webp-Bild kostete sonst bei JEDEM Durchgang einen Lauf. */
async function nurVorschau(setNummer: string, vorschau: string, st: StapelStand): Promise<void> {
  if (fs.existsSync(vorschau)) {
    st.erg.uebersprungen++;
    return;
  }
  if (istBekanntFehlend('thumb:' + vorschau)) {
    st.erg.bekanntFehlend++;
    return;
  }
  // Auch hier warten: Eine Verkleinerung kostet mehr als ein Download.
  await pauseVorArbeit();
  st.arbeit++;
  if (await vorschauErzeugen(`/images/sets/${setNummer}.jpg`, vorschau)) {
    st.erg.vorschau++;
    return;
  }
  st.erg.keineVorschau++;
  st.etwasZuTun = true;
  st.gruende.push(`${setNummer}: Vorschau fehlgeschlagen`);
}

/** @returns true, wenn das CDN drosselt und der Stapel abbricht */
async function nachFehlschlag(setNummer: string, info: { status?: number }, st: StapelStand): Promise<boolean> {
  const status = info.status;
  // Eine Drosselung ist KEINE Fehlanzeige: Die Bilder gibt es, und stures Weiterfragen verlängert die Sperre.
  if (status === 403 || status === 429) {
    const bis = new Date(Date.now() + DROSSEL_PAUSE_MS);
    await auftraegeBereich().auftraege.pausiereArt('bildbedarf', bis, `CDN drosselt (HTTP ${status})`);
    console.error(`[image-queue] CDN drosselt (HTTP ${status}) — Pause bis ${bis.toLocaleTimeString()}`);
    return true;
  }
  // NUR ein 404/410 heisst „das Bild gibt es nicht"; Zeitüberschreitungen und Netzaussetzer dürfen ein Bild
  // nicht dauerhaft sperren.
  const hartFehlend = info.status === 404 || info.status === 410;
  if (hartFehlend) merkeFehlend('set:' + setNummer, `HTTP ${status} vom CDN`);
  else st.etwasZuTun = true;
  st.erg.nichtGeladen++;
  st.gruende.push(
    `${setNummer}: Download fehlgeschlagen` +
      (status ? ` (HTTP ${status})` : ' (kein Statuscode — vorübergehend?)') +
      (hartFehlend ? '' : ', wird erneut versucht'),
  );
  return false;
}

async function arbeiteStapel(): Promise<StapelErgebnis> {
  const erg = leeresErgebnis();
  const pause = await auftraegeBereich().auftraege.liesPause('bildbedarf');
  if (pause && new Date(pause.bis).getTime() > Date.now()) return erg; // CDN hat gedrosselt, siehe unten
  const rows = await nimmBildwuensche(NOTIZ_GILT_MS, STAPEL);
  if (!rows.length) {
    merkeLauf(erg);
    return erg;
  }

  const st: StapelStand = { erg, gruende: [], etwasZuTun: false, arbeit: 0 };
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
      await nurVorschau(r.set_number, vorschau, st);
      await setBildLokalEintragen(r.set_number, r.url).catch(logAndContinue('bild-job:setBildLokal'));
      continue;
    }

    // Bekannt fehlende Bilder nicht erst holen, wie der Knopf „Katalogbilder holen" auch.
    if (istBekanntFehlend('set:' + r.set_number)) {
      erg.bekanntFehlend++;
      // Den Namen nennen: Ohne Setnummer führt kein Weg zu image-diag.
      st.gruende.push(
        `${r.set_number}: als fehlend bekannt` +
          (grundFuer('set:' + r.set_number) ? ` (${grundFuer('set:' + r.set_number)})` : ''),
      );
      continue;
    }

    // Die Pause steht ZWISCHEN zwei Anfragen ans CDN — nicht vor der ersten und nicht für Sets, deren Datei
    // schon da ist.
    await pauseVorArbeit();
    st.arbeit++;

    const info: { status?: number } = {};
    // Ein Fehler zählt wie ein vergeblicher Abruf; über die Wiederholung entscheidet nachFehlschlag().
    const abruf = await versuche('bild-job:downloadSetImage', downloadSetImage(r.url, r.set_number, info));
    const lokal = abruf.ok ? abruf.wert : null;
    if (!lokal) {
      if (await nachFehlschlag(r.set_number, info, st)) {
        // ALLE unbearbeiteten Notizen zurücklegen: Der Stapel kam per DELETE … RETURNING, der Rest wäre sonst
        // still verloren.
        const rest = rows.slice(idx);
        await notiereBildbedarf(
          rest.map(x => x.url),
          rest.map(x => x.set_number),
        ).catch(logAndContinue('bild-job:map'));
        erg.zurueckgelegt = rest.length;
        break;
      }
      continue;
    }
    // Die Vorschau entsteht NICHT in downloadSetImage(); ohne diesen Aufruf bliebe es bei der grossen
    // Originaldatei.
    await vorschauErzeugen(lokal, vorschau);
    // Erst der Eintrag lässt die Oberfläche die Datei statt des Proxys laden.
    await setBildLokalEintragen(r.set_number, r.url).catch(logAndContinue('bild-job:setBildLokal'));
    erg.geholt++;
  }
  // Zurückgelegte Zeilen sind NICHT bearbeitet.
  erg.gesamt = rows.length - erg.zurueckgelegt;
  erg.arbeit = st.arbeit;
  const { gruende, etwasZuTun } = st;
  // Bei wenigen Fällen beim Namen: Mit der Setnummer beantwortet GET /api/v1/admin/image-diag/:setNumber die
  // Frage in einer Antwort.
  if (gruende.length && gruende.length <= 5) {
    (etwasZuTun ? console.error : console.warn)(`[image-queue] ${gruende.join(' · ')}`);
  }
  // Hier festhalten: Wer den Stapel ausführt, hat gearbeitet, gleich von wo gerufen. In die Datenbank
  // schreibt erst der Takt.
  merkeLauf(erg);
  return erg;
}

/** Der Abbruch hängt an echter Arbeit, nicht an angefassten Notizen. */
async function taktDurchgang(): Promise<StapelErgebnis> {
  const summe = leeresErgebnis();
  while (summe.gesamt < DURCHGANG_MAX_NOTIZEN && summe.arbeit < STAPEL) {
    const e = await arbeiteStapel();
    summe.geholt += e.geholt;
    summe.vorschau += e.vorschau;
    summe.uebersprungen += e.uebersprungen;
    summe.gesamt += e.gesamt;
    summe.arbeit += e.arbeit;
    summe.nichtGeladen += e.nichtGeladen;
    summe.keineVorschau += e.keineVorschau;
    summe.bekanntFehlend += e.bekanntFehlend;
    summe.ohneNummer += e.ohneNummer;
    summe.zurueckgelegt += e.zurueckgelegt;
    if (!e.gesamt) break;
  }
  // Auch ein Takt, der nichts vorfand, ist ein Lebenszeichen für die Kachel.
  await speichereLauf(summe);
  return summe;
}

/** Drosselt das CDN, geht der Auftrag bis zum Ende der Pause zurück in die Tabelle. */
export async function bildbedarfAbarbeiten(k: AuftragsKontext): Promise<void> {
  await schreibePuffer();
  for (;;) {
    if (k.beendet) throw new AuftragUnterbrochen();
    const e = await taktDurchgang();
    if (e.gesamt || e.zurueckgelegt) console.log(`[image-queue] ${meldung(e)}`);
    const pause = await auftraegeBereich().auftraege.liesPause('bildbedarf');
    if (pause && new Date(pause.bis).getTime() > Date.now())
      throw new AuftragVerschieben(new Date(pause.bis), pause.grund ?? 'CDN drosselt');
    if (!e.gesamt) return;
    if (!(await k.fortschritt({ text: meldung(e) }))) return; // abgebrochen
    await warte(TAKT_MS);
  }
}

export { merkeGebraucht, initImageQueue, stoppeBildbedarf, anfragenJeMinute, STAPEL, TAKT_MS, DURCHGANG_MAX_NOTIZEN };

export {
  arbeiteStapel as _arbeiteStapel,
  taktDurchgang as _taktDurchgang,
  loescheVerfallene as _loescheVerfallene,
  schreibePuffer as _schreibePuffer,
};
