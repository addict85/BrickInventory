const db = require('../db/database');
// Echter Import statt spätem require(): Inzwischen liegt die Funktion in
// utils/setImages.ts und nicht mehr im Router — damit prüft tsc den Namen mit.
import { logAndContinue, meldeUndLiefere } from '../utils/httpError';
import { downloadSetImage } from '../utils/setImages';
import { grundFuer, istBekanntFehlend, merkeFehlend } from '../utils/imageMisses';
import { generateThumb } from '../utils/thumbs';
import { SET_IMAGES_DIR } from '../utils/appPaths';
import { setzeZustand } from '../utils/laufzustand';

/**
 * Bilder, die über den Proxy angefragt wurden, im HINTERGRUND lokal ablegen —
 * samt Vorschau.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#abschnitt
 */

/**
 * Wie schnell geholt wird
 * Beides zusammen ergibt die Taktung: zehn Bilder je Durchgang, dazwischen
 * jeweils eine Pause, alle 20 Sekunden ein Durchgang. Macht dreissig Anfragen
 * je Minute, und keine zwei davon fallen zusammen.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#stapel
 */
const STAPEL = 10;
const VERZOEGERUNG_MIN_MS = 500;
const VERZOEGERUNG_MAX_MS = 1000;
/** Pause zwischen den Durchgängen. */
const TAKT_MS = 20_000;
/** Ältere Notizen als diese verfallen: Was seit Tagen niemand ansah, eilt nicht. */
const NOTIZ_GILT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Wie viele Notizen ein Takt anfasst
 * — fünfmal hintereinander, bei 1113 Notizen in der Warteschlange.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#durchgang-max-notizen
 */
const DURCHGANG_MAX_NOTIZEN = 500;

/** Schlüssel in `laufzustand` für den Stand des letzten Durchgangs. */
const LAUF_SCHLUESSEL = 'imgqueue_last_run';

let _laeuft = false;
/**
 * Pause nach einer Drosselung durch das CDN.
 *
 * Fünf Minuten sind lang genug, dass ein kurzes Limit abläuft, und kurz genug,
 * dass ein nächtlicher Durchlauf nicht stehenbleibt. Wichtiger als die Länge
 * ist, dass überhaupt eine Pause entsteht: Stur weiterzufragen ist genau das
 * Verhalten, das eine Sperre verlängert.
 */
const DROSSEL_PAUSE_MS = 5 * 60 * 1000;
let _pauseBis = 0;

/** Kurz warten. Eigene Funktion, damit die Absicht im Aufruf sichtbar bleibt. */
function warte(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Zufällige Pause zwischen zwei Arbeitsschritten (siehe VERZOEGERUNG_*). */
function pause(): number {
  return VERZOEGERUNG_MIN_MS +
    Math.floor(Math.random() * (VERZOEGERUNG_MAX_MS - VERZOEGERUNG_MIN_MS));
}

/**
 * Zeitpunkt des letzten echten Arbeitsschritts — modulweit, nicht je Stapel.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#letztearbeit
 */
let _letzteArbeit = 0;

/**
 * Vor einem Arbeitsschritt so lange warten, dass der geforderte Abstand zum
 * vorigen eingehalten ist. Vor dem ALLERERSTEN wird nicht gewartet — der
 * Vorablauf soll nicht künstlich später beginnen.
 */
async function pauseVorArbeit(): Promise<void> {
  const soll = pause();
  if (_letzteArbeit) {
    const seit = Date.now() - _letzteArbeit;
    if (seit < soll) await warte(soll - seit);
  }
  _letzteArbeit = Date.now();
}

export async function initImageQueue(): Promise<void> {
  // Die Tabelle legt db/migrations/0009-bild-tabellen.sql an.

  // Wegschreiben läuft in JEDEM Arbeitsprozess
  // Er hat recht, und es ist derselbe Fehler wie in den Nachträgen 98 bis 100 —
  // diesmal in meinem eigenen Fix: Der Puffer liegt im ARBEITSSPEICHER eines
  // Prozesses, das Wegschreiben hing aber an start(), und start() läuft nur auf …
  // Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#initimagequeue
  setInterval(() => { schreibePuffer().catch(logAndContinue('bild-job:schreibePuffer')); }, 10_000).unref();
}

/**
 * Notieren, dass ein Bild gebraucht wurde. Wird vom Proxy aufgerufen und darf
 * NIE die Anfrage aufhalten — deshalb ohne await und mit verschlucktem Fehler.
 */
const _puffer = new Map<string, string>();   // url → set_number

export function merkeGebraucht(url: string, setNumber: string | null): void {
  if (!setNumber) return;
  // Gepuffert und im Takt in EINER Anweisung geschrieben: Ein INSERT je
  // Bildanfrage leerte bei einer Kachelwand den Pool für alle anderen Routen.
  if (_puffer.size < 500) _puffer.set(url, setNumber);
}

/** Den Puffer in einem Statement wegschreiben. */
async function schreibePuffer(): Promise<void> {
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  await db.run(
    `INSERT INTO image_wanted (url, set_number)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (url) DO NOTHING`, [urls, sets]
  ).catch(logAndContinue('bild-job:sets'));
}

/**
 * Eine Vorschau erzeugen — und einen Fehlschlag MERKEN.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#vorschauerzeugen
 */
async function vorschauErzeugen(relPfad: string, schluessel: string): Promise<boolean> {
  if (istBekanntFehlend('thumb:' + schluessel)) return false;
  const ok = await generateThumb(relPfad).catch(meldeUndLiefere('bild-job:generateThumb', false));
  if (!ok) merkeFehlend('thumb:' + schluessel, 'Vorschau konnte nicht erzeugt werden');
  return !!ok;
}

/**
 * Was ein Durchgang getan hat.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#stapelergebnis
 */
export type StapelErgebnis = {
  geholt: number; vorschau: number; uebersprungen: number; gesamt: number;
  /**
   * Die stillen Ausgänge
   * Die Zahlen gingen nicht auf, und das war kein Zufall: VIER Wege durch die
   * Schleife endeten, ohne irgendeinen der drei Zähler zu erhöhen — Notiz ohne
   * Setnummer, gescheiterte Verkleinerung, gescheiterter Download, und der …
   * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#stapelergebnis-2
   */
  nichtGeladen: number;
  keineVorschau: number;
  bekanntFehlend: number;
  ohneNummer: number;
  /** Nach einer Drosselung in die Warteschlange zurückgelegt. */
  zurueckgelegt: number;
  /**
   * Echte Arbeitsschritte: Downloads und Verkleinerungen. NICHT die Zahl der
   * angefassten Notizen — daran hing die Drosselung, und genau das war der
   * Fehler. Der Takt entscheidet an dieser Zahl, ob er noch
   * einen Stapel nachholt.
   */
  arbeit: number;
};

/** Ein leeres Ergebnis — eine Stelle, damit kein Zähler beim Ergänzen vergessen wird. */
function leeresErgebnis(): StapelErgebnis {
  return {
    geholt: 0, vorschau: 0, uebersprungen: 0, gesamt: 0,
    nichtGeladen: 0, keineVorschau: 0, bekanntFehlend: 0, ohneNummer: 0,
    zurueckgelegt: 0, arbeit: 0,
  };
}

/**
 * Die Meldung eines Durchgangs. Genannt wird, was NICHT null ist — sonst steht
 * in jeder Zeile ein halbes Dutzend Nullen, und die eine Zahl, auf die es
 * ankommt, geht darin unter.
 */
export function meldung(e: StapelErgebnis): string {
  const teile = [`${e.geholt} geladen`, `${e.vorschau} Vorschau erzeugt`,
                 `${e.uebersprungen} bereits vorhanden`];
  if (e.nichtGeladen)   teile.push(`${e.nichtGeladen} Download fehlgeschlagen`);
  if (e.keineVorschau)  teile.push(`${e.keineVorschau} Vorschau fehlgeschlagen`);
  if (e.bekanntFehlend) teile.push(`${e.bekanntFehlend} als fehlend bekannt`);
  if (e.ohneNummer)     teile.push(`${e.ohneNummer} ohne Setnummer`);
  if (e.zurueckgelegt)  teile.push(`${e.zurueckgelegt} zurückgelegt`);
  return `${e.gesamt} bearbeitet: ${teile.join(', ')}`;
}

/**
 * Stand des letzten Durchgangs — für die Überwachungskachel.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#letzterlauf
 */
export const letzterLauf: { zeit: number | null; ergebnis: StapelErgebnis | null } =
  { zeit: null, ergebnis: null };

/** Den Stand eines Stapels im Modul festhalten. */
function merkeLauf(erg: StapelErgebnis): void {
  letzterLauf.zeit = Date.now();
  letzterLauf.ergebnis = erg;
}

/**
 * Den Stand für die anderen Arbeitsprozesse ablegen — einmal je Takt, nicht
 * je Stapel: Die Kachel liest Minuten, und eine SD-Karte schont das.
 */
async function speichereLauf(erg: StapelErgebnis): Promise<void> {
  // Das await gehoert hier hin: Der naechste Takt liest den Stand ueber einen
  // ANDEREN Prozess wieder aus. Ohne await kehrt der Aufrufer zurueck, bevor
  // die Zeile steht — die Kachel meldet dann „Job noch nicht gelaufen", waehrend
  // im Log Durchgaenge stehen.
  await setzeZustand(LAUF_SCHLUESSEL, JSON.stringify({ zeit: Date.now(), ergebnis: erg }))
    .catch(logAndContinue('bild-job:setzeZustand'));
}

/**
 * Verfallene Notizen löschen.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#loescheverfallene
 */
async function loescheVerfallene(): Promise<number> {
  const r = await db.run(
    `DELETE FROM image_wanted
      WHERE requested_at <= NOW() - ($1 || ' milliseconds')::interval`,
    [String(NOTIZ_GILT_MS)]
  ).catch(meldeUndLiefere('bild-job:r', null));
  return r?.changes || 0;
}

async function arbeiteStapel(): Promise<StapelErgebnis> {
  const erg = leeresErgebnis();
  if (Date.now() < _pauseBis) return erg;   // CDN hat gedrosselt, siehe unten
  const rows = await db.all(
    `DELETE FROM image_wanted
      WHERE url IN (SELECT url FROM image_wanted
                     WHERE requested_at > NOW() - ($1 || ' milliseconds')::interval
                     ORDER BY requested_at ASC LIMIT $2)
      RETURNING url, set_number`,
    [String(NOTIZ_GILT_MS), STAPEL]
  ).catch(meldeUndLiefere('bild-job:rows', []));
  if (!rows.length) { merkeLauf(erg); return erg; }


  /** Setnummern mit Grund — bei wenigen Fällen nennt die Meldung sie beim Namen. */
  const gruende: string[] = [];
  // Traegt dieser Stapel etwas, das Aufmerksamkeit braucht? Ein 404 vom CDN
  // tut es nicht (siehe die Sammelzeile am Ende), alles andere schon.
  let etwasZuTun = false;

  const fs = require('fs');
  const path = require('path');

  let fertig = 0;
  /**
   * Zählt ARBEIT, nicht nur Downloads.
   * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#arbeitestapel-arbeit
   */
  let arbeit = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (!r.set_number) { erg.ohneNummer++; continue; }   // ohne Setnummer kein Ablageort

    // Liegt das Bild schon? Dann nur die Vorschau nachholen
    // Der Knopf „Alle Katalogbilder holen" reiht ALLE Sets ein, ohne je Datei
    // zu prüfen — 25 000 Dateizugriffe in einer Anfrage wären auf schwacher
    // Hardware eine spürbare Blockade. Die Prüfung gehört hierher, wo ohnehin …
    // Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#arbeitestapel-datei
    const datei  = path.join(SET_IMAGES_DIR, `${r.set_number}.jpg`);
    const vorschau = path.join(SET_IMAGES_DIR, `${r.set_number}_thumb.jpg`);
    if (fs.existsSync(datei)) {
      // Bekannt gescheiterte Vorschauen gar nicht erst anfassen — sonst
      // kostet jedes webp-Bild bei JEDEM Durchgang einen vergeblichen Lauf.
      if (fs.existsSync(vorschau)) erg.uebersprungen++;
      else if (istBekanntFehlend('thumb:' + vorschau)) {
        // VOR der Pause und VOR dem Kontingent: Eine Verkleinerung, die nie
        // gelingen kann, soll weder warten noch einen CDN-Platz kosten.
        erg.bekanntFehlend++;
      }
      else {
        // Auch hier warten: Eine Verkleinerung kostet mehr als ein Download.
        await pauseVorArbeit();
        arbeit++;
        if (await vorschauErzeugen(`/images/sets/${r.set_number}.jpg`, vorschau)) { fertig++; erg.vorschau++; }
        // Eine gescheiterte Vorschau IST etwas zu tun: Die Originaldatei
        // liegt da, nur liess sie sich nicht verkleinern — das deutet auf
        // eine kaputte oder unbekannte Datei und wiederholt sich bei jedem
        // Takt, solange niemand hinsieht.
        else { erg.keineVorschau++; etwasZuTun = true;
               gruende.push(`${r.set_number}: Vorschau fehlgeschlagen`); }
      }
      continue;   // kein zweiter Download
    }

    // Bekannt fehlende Bilder gar nicht erst holen
    // merkeFehlend('set:…') wurde weiter unten GESCHRIEBEN, aber nirgends im
    // Job gelesen — der Knopf „Katalogbilder holen" achtet darauf (per SQL),
    // der Job nicht. Eine Notiz, die über den Proxy erneut entsteht, löste …
    // Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#arbeitestapel
    if (istBekanntFehlend('set:' + r.set_number)) {
      erg.bekanntFehlend++;
      // Auch hier den Namen nennen: „2 als fehlend bekannt" beantwortet, WELCHER
      // Ausgang genommen wurde, aber nicht, um welche Sets es geht — und ohne
      // Setnummer führt kein Weg zu image-diag.
      gruende.push(`${r.set_number}: als fehlend bekannt` +
                   (grundFuer('set:' + r.set_number) ? ` (${grundFuer('set:' + r.set_number)})` : ''));
      continue;
    }

    // Die Pause steht ZWISCHEN zwei Anfragen ans CDN — nicht vor der ersten
    // und nicht für Sets, deren Datei schon da ist (oben abgekürzt).
    await pauseVorArbeit();
    arbeit++;

    const info: { status?: number } = {};
    const lokal = await downloadSetImage(r.url, r.set_number, info).catch(meldeUndLiefere('bild-job:downloadSetImage', null));
    if (!lokal) {
      // Drosselung ist KEINE Fehlanzeige
      // Beim Nachsehen fiel auf: Bisher galt jeder Fehlschlag als „dieses Bild
      // gibt es nicht" — auch ein 403 oder 429. Gerade bei einer Drosselung
      // sind die Bilder aber VORHANDEN, und der Ansturm, der sie auslöst, …
      // Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#arbeitestapel-2
      if (info.status === 403 || info.status === 429) {
        _pauseBis = Date.now() + DROSSEL_PAUSE_MS;
        console.error(`[image-queue] CDN drosselt (HTTP ${info.status}) — Pause bis ` +
                      new Date(_pauseBis).toLocaleTimeString());
        // ALLE noch unbearbeiteten Notizen zurücklegen: Der Stapel kam per
        // DELETE … RETURNING, der Rest wäre sonst still verloren.
        const rest = rows.slice(idx);
        await db.run(
          `INSERT INTO image_wanted (url, set_number)
             SELECT * FROM unnest($1::text[], $2::text[])
             ON CONFLICT (url) DO NOTHING`,
          [rest.map((x: any) => x.url), rest.map((x: any) => x.set_number)]).catch(logAndContinue('bild-job:map'));
        erg.zurueckgelegt = rest.length;
        break;
      }
      // NUR ein 404 heisst „das Bild gibt es nicht"
      // Bis hierher merkte sich der Job JEDEN Fehlschlag ausser 403/429: eine
      // Zeitüberschreitung, einen DNS-Aussetzer, eine abgebrochene Verbindung,
      // „Antwort zu klein", „zu viele Weiterleitungen", ein zu grosses Bild — …
      // Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#arbeitestapel-hartfehlend
      const hartFehlend = info.status === 404 || info.status === 410;
      if (hartFehlend) merkeFehlend('set:' + r.set_number, `HTTP ${info.status} vom CDN`);
      // Ob in diesem Stapel ueberhaupt etwas steht, das Aufmerksamkeit
      // braucht — siehe die Begruendung bei der Sammelzeile unten.
      if (!hartFehlend) etwasZuTun = true;
      erg.nichtGeladen++;
      gruende.push(`${r.set_number}: Download fehlgeschlagen` +
                   (info.status ? ` (HTTP ${info.status})` : ' (kein Statuscode — vorübergehend?)') +
                   (hartFehlend ? '' : ', wird erneut versucht'));
      continue;
    }
    // Die Vorschau entsteht NICHT in downloadSetImage() — sie muss hier
    // angestossen werden, sonst bliebe es bei der grossen Originaldatei.
    await vorschauErzeugen(lokal, vorschau);
    fertig++; erg.geholt++;
  }
  // ── Zurückgelegte Zeilen sind NICHT bearbeitet ────────────
  //
  // Nach einer Drosselung wandern die restlichen Notizen zurück in die
  // Warteschlange. `rows.length` meldete sie trotzdem als bearbeitet — bei
  // einem Stapel, der schon an der ERSTEN Zeile abbricht, stand da „2
  // bearbeitet", obwohl null Zeilen verbraucht und zwei zurückgelegt wurden.
  erg.gesamt = rows.length - erg.zurueckgelegt;
  erg.arbeit = arbeit;
  // Die Betroffenen beim Namen nennen
  // Eine Zahl sagt „zwei sind gescheitert", nicht WELCHE. Genau das fehlte
  // Marco, um weiterzukommen: Mit der Setnummer beantwortet
  // GET /api/v1/admin/image-diag/:setNumber die Frage in EINER Antwort.
  // Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#arbeitestapel-3
  if (gruende.length && gruende.length <= 5) {
    (etwasZuTun ? console.error : console.warn)(`[image-queue] ${gruende.join(' · ')}`);
  }
  // HIER festhalten, nicht erst im Takt: Wer diesen Stapel ausführt, hat
  // gearbeitet — gleich, von wo er gerufen wurde. In die DATENBANK schreibt
  // erst der Takt (speichereLauf).
  merkeLauf(erg);
  return erg;
}

/**
 * Ein Takt: Stapel nachholen, bis das Kontingent für echte Arbeit aufgebraucht
 * ist, die Warteschlange leer ist oder der Deckel greift.
 * Ausführlich: docs/begruendungen/jobs/imageQueue.ts.md#taktdurchgang
 */
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
    // Nichts mehr da — oder die Drosselung hat abgebrochen. In beiden Fällen
    // ist Weitermachen sinnlos.
    if (!e.gesamt) break;
  }
  // Für die anderen Arbeitsprozesse ablegen — auch ein Takt, der nichts
  // vorfand, ist ein Lebenszeichen. Genau das fehlte der Kachel.
  await speichereLauf(summe);
  return summe;
}

export function start(): void {
  if (_laeuft) return;
  _laeuft = true;
  let _naechsterVerfall = 0;
  const takt = async () => {
    try {
      await schreibePuffer();
      // Verfallene Notizen wegräumen — nicht in jedem Takt, sondern stündlich:
      // Ohne Frist wäre es alle zwanzig Sekunden ein Durchgang durch die ganze
      // Tabelle, und dringend ist die Aufräumarbeit nicht.
      if (Date.now() >= _naechsterVerfall) {
        _naechsterVerfall = Date.now() + 60 * 60 * 1000;
        const weg = await loescheVerfallene();
        if (weg) console.log(`[image-queue] ${weg} verfallene Notizen entfernt`);
      }
      const e = await taktDurchgang();
      // Auch melden, wenn NUR übersprungen wurde: Sonst schweigt der Job
      // genau dann, wenn er am schnellsten arbeitet — und sieht von aussen
      // aus wie einer, der hängt.
      // Auch ein Takt, der NUR zurückgelegt hat, gehört gemeldet — sonst
      // schweigt der Job ausgerechnet bei einer Drosselung.
      if (e.gesamt || e.zurueckgelegt) console.log(`[image-queue] ${meldung(e)}`);
    } catch (e: any) { console.error('[image-queue]', e.message); }
  };
  // Erster Lauf verzögert: Beim Start hat der Server anderes zu tun.
  setTimeout(takt, 30_000);
  setInterval(takt, TAKT_MS).unref();
}

/**
 * Wie viele CDN-Anfragen der Job je Minute stellt.
 *
 * Für Abschätzungen an anderer Stelle („wie lange dauert das?"). Die Zahl steht
 * hier und wird nicht anderswo wiederholt — sonst laufen Takt und Auskunft
 * auseinander, sobald jemand STAPEL oder TAKT_MS ändert.
 */
export function anfragenJeMinute(): number {
  return STAPEL * (60_000 / TAKT_MS);
}

export {
  arbeiteStapel as _arbeiteStapel,
  taktDurchgang as _taktDurchgang,
  loescheVerfallene as _loescheVerfallene,
  schreibePuffer as _schreibePuffer,
};
