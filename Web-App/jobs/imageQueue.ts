const db = require('../db/database');
// Echter Import statt spätem require(): Seit Nachtrag 125 liegt die Funktion in
// utils/setImages.ts und nicht mehr im Router — damit prüft tsc den Namen mit.
import { downloadSetImage } from '../utils/setImages';
import { grundFuer, istBekanntFehlend, merkeFehlend } from '../utils/imageMisses';
import { generateThumb } from '../routes/thumbs';
import { SET_IMAGES_DIR } from '../utils/appPaths';

/**
 * Bilder, die über den Proxy angefragt wurden, im HINTERGRUND lokal ablegen —
 * samt Vorschau.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Ich fänd es sinnvoll, wenn die Bilder lokal gecached werden inkl. Thumbs.
 * Bitte aber die Bilder im Hintergrund mit dem Bilder-Download-Job
 * herunterladen und das Thumb erstellen, sobald sie einmal via Proxy geladen
 * wurden. Das sollte das gleiche Prinzip wie bei den anderen Reitern sein."
 *
 * ── Warum das der richtige Zuschnitt ist ────────────────────────────────────
 * Vorher hingen zwei Dinge an der ANFRAGE: Der Proxy holte das Bild und stiess
 * sofort die Verkleinerung an. Bei den eigenen Sets ist das unauffällig — ein
 * paar hundert Bilder, einmalig. Im Katalog mit 25 000 fremden Sets wurde
 * daraus eine Rechenlawine, die lange nach dem Scrollen weiterlief (Marcos
 * 329 % CPU).
 *
 * In Nachtrag 101 hatte ich die Verkleinerung im Katalog deshalb ganz
 * abgeschaltet. Das war zu grob: Wer ein Set zweimal ansieht, soll beim zweiten
 * Mal das kleine Bild bekommen.
 *
 * Jetzt trennt sich beides sauber:
 *   • Die Anfrage liefert sofort aus — mit Vorschau, wenn es sie gibt, sonst
 *     mit dem Original. Sie rechnet NICHTS.
 *   • Sie hinterlässt eine Notiz: „dieses Bild wurde gebraucht".
 *   • Dieser Job arbeitet die Notizen ab, gedrosselt und nur auf dem
 *     Primärprozess.
 *
 * Der Unterschied zur Warteschlange im Arbeitsspeicher (die es vorher gab): Die
 * Notizen stehen in der DATENBANK. Sie überleben den Neustart, und alle
 * Arbeitsprozesse schreiben in dieselbe — die Lehre aus den Nachträgen 98 bis
 * 100, wo Grenzen je Prozess galten und deshalb nicht wirkten.
 */

/**
 * ── Wie schnell geholt wird (Marcos Vorgaben, Nachtrag 113) ─────────────────
 *
 * „Nur 30 Requests pro Minute" und „eine künstliche Verzögerung von mindestens
 * 500 bis 1000 ms zwischen den einzelnen Bild-Requests".
 *
 * Beides zusammen ergibt die Taktung: zehn Bilder je Durchgang, dazwischen
 * jeweils eine Pause, alle 20 Sekunden ein Durchgang. Macht dreissig Anfragen
 * je Minute, und keine zwei davon fallen zusammen.
 *
 * Die Verzögerung ist ZUFÄLLIG zwischen 500 und 1000 ms. Ein exakt gleicher
 * Abstand ist selbst ein Muster — eine Heuristik, die nach Maschinen sucht,
 * erkennt Gleichmass leichter als Unregelmässigkeit.
 *
 * Warum nicht nur bei grossen Mengen: Marco hatte die Vorgaben für Läufe über
 * 200 Bildern gestellt. Die Unterscheidung einzubauen hiesse, zwei Verhalten zu
 * pflegen und zu prüfen — für den Gewinn, beim Blättern drei Bilder eine
 * Sekunde früher zu haben. Der Vorablauf ist ohnehin nichts, worauf jemand
 * wartet.
 */
const STAPEL = 10;
const VERZOEGERUNG_MIN_MS = 500;
const VERZOEGERUNG_MAX_MS = 1000;
/** Pause zwischen den Durchgängen. */
const TAKT_MS = 20_000;
/** Ältere Notizen als diese verfallen: Was seit Tagen niemand ansah, eilt nicht. */
const NOTIZ_GILT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * ── Wie viele Notizen ein Takt anfasst (Nachtrag 121) ───────────────────────
 *
 * Marcos Log:
 *
 *     [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden
 *
 * — fünfmal hintereinander, bei 1113 Notizen in der Warteschlange.
 *
 * Der Job arbeitete korrekt ab, nur unendlich langsam: STAPEL Notizen je
 * TAKT_MS, das sind dreissig je Minute, also gut 37 Minuten für Marcos
 * Warteschlange. In diesen fünf Durchgängen wurde dabei NICHTS geholt und
 * NICHTS gerechnet — für alle zehn lagen Bild und Vorschau längst da. Zwanzig
 * `existsSync`-Aufrufe, wenige Millisekunden, danach nahezu zwanzig Sekunden
 * Stillstand.
 *
 * Die Ursache ist ein falscher Bezug: Die Dreissiger-Grenze ist Marcos Vorgabe
 * gegen eine Sperre durch das CDN („nur 30 Requests pro Minute"). Gezählt
 * wurden aber NOTIZEN. Eine übersprungene Notiz kostet das CDN nichts und darf
 * das Kontingent folglich auch nicht verbrauchen.
 *
 * Innerhalb eines Stapels war das längst richtig — der Zähler `arbeit` sorgt
 * seit Nachtrag 116 dafür, dass Übersprünge keine Pause kosten. Nur auf den
 * NÄCHSTEN Stapel wirkte er nicht.
 *
 * Jetzt gilt das Kontingent für die Arbeit: Ein Takt holt so lange Stapel nach,
 * bis STAPEL echte Arbeitsschritte getan sind (Download oder Verkleinerung),
 * die Warteschlange leer ist oder der Deckel unten greift. Die Rate am CDN
 * bleibt damit unverändert bei STAPEL je TAKT_MS.
 *
 * Der Deckel begrenzt, was ein Takt an ÜBERSPRÜNGEN durchsieht. Er ist nötig,
 * weil `existsSync` synchron ist: Ohne ihn liefe eine Warteschlange aus 25 000
 * fertigen Bildern in einem Zug durch und hielte den Event-Loop des
 * Arbeitsprozesses in Schüben auf. Fünfhundert sind 1000 Dateizugriffe je
 * zwanzig Sekunden — genug, um Marcos 1113 in einer Minute abzuräumen, und
 * wenig genug, um zwischendurch Anfragen zu bedienen.
 */
const DURCHGANG_MAX_NOTIZEN = 500;

/** Schlüssel in `global_settings` für den Stand des letzten Durchgangs. */
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
 *
 * Vorher hing die Pause an einem Zähler INNERHALB eines Stapels. Seit ein Takt
 * mehrere Stapel nachholt, wäre der erste Arbeitsschritt jedes Folgestapels
 * ohne Abstand gelaufen: zwei CDN-Anfragen unmittelbar hintereinander, genau
 * das Muster, das Marcos Vorgabe vermeiden soll. Der Abstand gehört deshalb
 * zwischen zwei ARBEITSSCHRITTE, gleich in welchem Stapel sie liegen.
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

  // ── Wegschreiben läuft in JEDEM Arbeitsprozess ───────────────────────────
  //
  // Marcos Befund: „Ich habe das Gefühl, die Bilder aus dem Katalog werden
  // nicht heruntergeladen im Hintergrund. Es sind immer gleich viele Bilder im
  // Ordner images/sets."
  //
  // Er hat recht, und es ist derselbe Fehler wie in den Nachträgen 98 bis 100 —
  // diesmal in meinem eigenen Fix: Der Puffer liegt im ARBEITSSPEICHER eines
  // Prozesses, das Wegschreiben hing aber an start(), und start() läuft nur auf
  // dem Primärprozess. Bildanfragen verteilen sich über alle vier — drei
  // Viertel aller Notizen wurden also nie geschrieben, und was der Primär
  // notierte, nur wenn er die Anfrage zufällig selbst bediente.
  //
  // initImageQueue() läuft dagegen in JEDEM Prozess (aus db/database.ts).
  // Deshalb steht der Takt hier und nicht in start().
  setInterval(() => { schreibePuffer().catch(() => {}); }, 10_000).unref();
}

/**
 * Notieren, dass ein Bild gebraucht wurde. Wird vom Proxy aufgerufen und darf
 * NIE die Anfrage aufhalten — deshalb ohne await und mit verschlucktem Fehler.
 */
const _puffer = new Map<string, string>();   // url → set_number

export function merkeGebraucht(url: string, setNumber: string | null): void {
  if (!setNumber) return;
  // GEPUFFERT (Nachtrag 103): Ein INSERT je Bildanfrage belegte eine Verbindung
  // aus dem Pool — bei einer Kachelwand dutzende gleichzeitig. Der Pool war
  // damit leer, und ANDERE Routen liefen in den Zeitfehler:
  //
  //     [route-error] 500: timeout exceeded when trying to connect at getStats
  //
  // Der Puffer wird im Takt weggeschrieben, in EINEM Statement.
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
  ).catch(() => {});
}

/**
 * Einen Stapel abarbeiten: Original lokal ablegen, Vorschau erzeugen, Notiz
 * entfernen.
 *
 * Fehlschläge werden NICHT wiederholt: Die Notiz verschwindet, und der Merker
 * für fehlende Bilder (utils/imageMisses.ts) sorgt dafür, dass es nicht gleich
 * wieder versucht wird.
 */
/**
 * Eine Vorschau erzeugen — und einen Fehlschlag MERKEN.
 *
 * ── Marcos Log (Nachtrag 117) ───────────────────────────────────────────────
 *     [thumb] Vorschau fehlgeschlagen für /images/sets/5007579-1.jpg:
 *             Mime type image/webp does not support decoding
 * — und dieselbe Zeile für 5007576-1, 5007623-1, immer wieder.
 *
 * Jimp kann webp nicht entpacken. In Nachtrag 104 habe ich das gemerkt — aber
 * nur im Bild-Proxy. Der Job hier ruft `generateThumb()` DIREKT auf und
 * verschluckt den Fehler (`.catch(() => {})`). Also:
 *
 *   • Es entsteht keine Datei.
 *   • Beim nächsten Durchgang gilt „Bild da, Vorschau fehlt" — und es wird
 *     erneut versucht.
 *   • Nach jedem Klick auf „Katalogbilder holen" wieder.
 *
 * Für jedes webp-Bild also ein vergeblicher Jimp-Lauf, der die Datei erst
 * einliest und dann aufgibt. Auf einem Raspberry Pi ist das genau die Arbeit,
 * die niemand haben will.
 *
 * Wieder derselbe Befund wie so oft in dieser Reihe: Der Schutz existierte,
 * sein Geltungsbereich war zu eng — er stand im Proxy, nicht im Job.
 */
async function vorschauErzeugen(relPfad: string, schluessel: string): Promise<boolean> {
  if (istBekanntFehlend('thumb:' + schluessel)) return false;
  const ok = await generateThumb(relPfad).catch(() => false);
  if (!ok) merkeFehlend('thumb:' + schluessel, 'Vorschau konnte nicht erzeugt werden');
  return !!ok;
}

/**
 * Was ein Durchgang getan hat.
 *
 * ── Warum nicht nur eine Zahl (Nachtrag 120) ────────────────────────────────
 * Marcos Befund: „Der Bild-CDN-Job scheint zu laufen laut Monitoring und
 * Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."
 *
 * Er hatte recht, und das Schweigen war eingebaut: Der Takt meldete nur, wenn
 * `fertig > 0`. Ein Durchgang, der zehn Notizen abarbeitet und alle
 * überspringt — weil Bild und Vorschau längst liegen —, sagte nichts. Von
 * aussen sah das aus wie ein hängender Job, obwohl die Warteschlange schrumpfte.
 *
 * Schlimmer war die Kachel: Sie meldete „läuft", sobald die Warteschlange nicht
 * leer war (Nachtrag 108). Das ist keine Aussage über TÄTIGKEIT — eine
 * steckengebliebene Warteschlange sah genauso aus wie eine, die abgearbeitet
 * wird. Die Anzeige konnte den Unterschied gar nicht kennen.
 */
export type StapelErgebnis = {
  geholt: number; vorschau: number; uebersprungen: number; gesamt: number;
  /**
   * ── Die stillen Ausgänge (Nachtrag 122) ───────────────────────────────────
   *
   * Marcos Log:
   *     [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden
   * — zweimal, und seine Frage: „Wieso werden die 2 Bilder nicht geladen?"
   *
   * Die Zahlen gingen nicht auf, und das war kein Zufall: VIER Wege durch die
   * Schleife endeten, ohne irgendeinen der drei Zähler zu erhöhen — Notiz ohne
   * Setnummer, gescheiterte Verkleinerung, gescheiterter Download, und der
   * Abbruch nach einer Drosselung. Die Meldung konnte die vier nicht
   * unterscheiden und meldete für alle dasselbe Nichts.
   *
   * Das ist derselbe Fehler wie in Nachtrag 120, eine Ebene tiefer: Dort
   * schwieg der Job, wenn nichts GETAN wurde; hier schweigt er, wenn etwas
   * SCHIEFGING. Ein Zähler je Ausgang, und die Frage beantwortet sich selbst.
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
   * Fehler aus Nachtrag 121. Der Takt entscheidet an dieser Zahl, ob er noch
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
 *
 * ── Warum das nicht im Arbeitsspeicher bleiben durfte (Nachtrag 121) ────────
 * Marcos Kachel meldete „Job noch nicht gelaufen", während im Log gerade fünf
 * Durchgänge standen.
 *
 * Dieser Merker lag ausschliesslich hier im Modul. Gesetzt wird er dort, wo der
 * Job läuft — im Primär-Worker. Gelesen wurde er in routes/api_v1/admin.ts von
 * dem Worker, der die Monitoring-Anfrage zufällig bediente. Bei vier Workern
 * sah die Kachel also in drei von vier Fällen `null` und schloss daraus auf
 * „noch nicht gelaufen".
 *
 * Das ist zum siebten Mal dasselbe Muster dieser Reihe: prozesslokaler Zustand
 * im Cluster. Bitter ist, dass es für genau diesen Zweck utils/jobMonitor.ts
 * gibt („stores status in PostgreSQL so all cluster workers share state") — die
 * vorgesehene Ablage wurde hier umgangen.
 *
 * Der Merker bleibt im Modul, weil der Takt ihn im Sekundenbereich braucht;
 * maßgeblich für die Kachel ist aber die Zeile in `global_settings`.
 */
export const letzterLauf: { zeit: number | null; ergebnis: StapelErgebnis | null } =
  { zeit: null, ergebnis: null };

/** Den Stand eines Stapels im Modul festhalten. */
function merkeLauf(erg: StapelErgebnis): void {
  letzterLauf.zeit = Date.now();
  letzterLauf.ergebnis = erg;
}

/**
 * Den Stand für die anderen Arbeitsprozesse ablegen — EINMAL je Takt.
 *
 * Bewusst nicht je Stapel: Ein Takt besteht jetzt aus bis zu fünfzig davon, und
 * ein Schreibvorgang alle paar Millisekunden ist auf der SD-Karte eines
 * Raspberry Pi keine gute Idee. Einmal je zwanzig Sekunden reicht der Kachel
 * reichlich — sie wertet den Zeitpunkt in Minuten aus.
 */
async function speichereLauf(erg: StapelErgebnis): Promise<void> {
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
    [LAUF_SCHLUESSEL, JSON.stringify({ zeit: Date.now(), ergebnis: erg })]
  ).catch(() => {});
}

/**
 * Verfallene Notizen löschen.
 *
 * ── Was der Kommentar behauptete und der Code nicht tat (Nachtrag 121) ──────
 * Bei NOTIZ_GILT_MS stand „Ältere Notizen als diese verfallen". Sie verfielen
 * nicht: Die Abfrage des Stapels grenzt nur ein, was sie AUSWÄHLT — gelöscht
 * wurde nie etwas anderes. Notizen älter als drei Tage blieben also für immer
 * liegen, zählten weiter in der Kachel (COUNT(*) ohne Frist) und liessen den
 * Job verstummen, weil die Logzeile an `gesamt > 0` hängt. Von aussen sah das
 * aus wie eine Warteschlange, die bei einer Zahl stehenbleibt.
 */
async function loescheVerfallene(): Promise<number> {
  const r = await db.run(
    `DELETE FROM image_wanted
      WHERE requested_at <= NOW() - ($1 || ' milliseconds')::interval`,
    [String(NOTIZ_GILT_MS)]
  ).catch(() => null);
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
  ).catch(() => []);
  if (!rows.length) { merkeLauf(erg); return erg; }


  /** Setnummern mit Grund — bei wenigen Fällen nennt die Meldung sie beim Namen. */
  const gruende: string[] = [];

  const fs = require('fs');
  const path = require('path');

  let fertig = 0;
  /**
   * Zählt ARBEIT, nicht nur Downloads.
   *
   * ── Marcos Log (Nachtrag 116) ────────────────────────────────────────────
   * Zeile um Zeile „[image-queue] N Bilder lokal abgelegt", dazwischen
   * `Connection terminated due to connection timeout` — bis hin zum
   * Sitzungsspeicher, der keine Verbindung mehr bekam.
   *
   * Die Pause aus Nachtrag 113 hing an `geholt`, und das zählte nur echte
   * Downloads. Lag ein Bild bereits lokal, fehlte ihm aber die Vorschau, lief
   * der Zweig darüber: Vorschau rechnen, `continue` — OHNE Pause. Nach dem
   * Knopf „Katalogbilder holen" ist das der Normalfall, denn 16 000 Bilder
   * lagen schon.
   *
   * Ergebnis: zehn Jimp-Läufe je Durchgang, ohne Atempause, auf einem
   * Raspberry Pi. Die CPU war belegt, und alles andere — Datenbankabfragen
   * eingeschlossen — kam nicht mehr durch.
   *
   * Eine Verkleinerung ist die TEUERSTE Einzelarbeit im Server. Dass die Pause
   * nur den billigeren Teil betraf, war der Fehler.
   */
  let arbeit = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (!r.set_number) { erg.ohneNummer++; continue; }   // ohne Setnummer kein Ablageort

    // ── Liegt das Bild schon? Dann nur die Vorschau nachholen ───────────────
    //
    // Der Knopf „Alle Katalogbilder holen" reiht ALLE Sets ein, ohne je Datei
    // zu prüfen — 25 000 Dateizugriffe in einer Anfrage wären auf schwacher
    // Hardware eine spürbare Blockade. Die Prüfung gehört hierher, wo ohnehin
    // gedrosselt gearbeitet wird.
    //
    // Der zweite Teil ist Marcos ausdrückliche Frage: „Bitte auch prüfen, dass
    // für Katalogbilder jeweils ein Thumbs-Image erstellt wird." Für Bilder,
    // die vor dem Hintergrund-Job abgelegt wurden, fehlt die Vorschau
    // womöglich — hier wird sie nachgezogen.
    const datei  = path.join(SET_IMAGES_DIR, `${r.set_number}.jpg`);
    const vorschau = path.join(SET_IMAGES_DIR, `${r.set_number}_thumb.jpg`);
    if (fs.existsSync(datei)) {
      // Bekannt gescheiterte Vorschauen gar nicht erst anfassen — sonst
      // kostet jedes webp-Bild bei JEDEM Durchgang einen vergeblichen Lauf.
      if (fs.existsSync(vorschau)) erg.uebersprungen++;
      else if (istBekanntFehlend('thumb:' + vorschau)) {
        // ── VOR der Pause und VOR dem Kontingent (Nachtrag 122) ────────────
        //
        // Die Prüfung stand bisher INNERHALB von vorschauErzeugen(), also
        // hinter beidem. Eine Verkleinerung, die nie gelingen kann (webp vor
        // Nachtrag 118), kostete damit bei jedem Durchgang eine
        // Höflichkeitspause UND einen Platz im CDN-Kontingent — für einen
        // Aufruf, der sofort `false` zurückgibt. Zehn solcher Notizen
        // verbrauchten einen ganzen Takt mit reinem Schlafen.
        erg.bekanntFehlend++;
      }
      else {
        // Auch hier warten: Eine Verkleinerung kostet mehr als ein Download.
        await pauseVorArbeit();
        arbeit++;
        if (await vorschauErzeugen(`/images/sets/${r.set_number}.jpg`, vorschau)) { fertig++; erg.vorschau++; }
        else { erg.keineVorschau++; gruende.push(`${r.set_number}: Vorschau fehlgeschlagen`); }
      }
      continue;   // kein zweiter Download
    }

    // ── Bekannt fehlende Bilder gar nicht erst holen (Nachtrag 122) ────────
    //
    // merkeFehlend('set:…') wurde weiter unten GESCHRIEBEN, aber nirgends im
    // Job gelesen — der Knopf „Katalogbilder holen" achtet darauf (per SQL),
    // der Job nicht. Eine Notiz, die über den Proxy erneut entsteht, löste
    // deshalb bei jedem Durchgang wieder einen Roundtrip zu einem Bild aus,
    // von dem längst feststand, dass es der CDN nicht hat — und verbrauchte
    // dafür einen Platz im Kontingent.
    //
    // Die Prüfung steht VOR der Pause: Ein Bild, das der CDN nicht hat, kostet
    // ihn nichts und darf deshalb weder das Kontingent noch Wartezeit belegen.
    if (istBekanntFehlend('set:' + r.set_number)) {
      erg.bekanntFehlend++;
      // Auch hier den Namen nennen: „2 als fehlend bekannt" beantwortet, WELCHER
      // Ausgang genommen wurde, aber nicht, um welche Sets es geht — und ohne
      // Setnummer führt kein Weg zu image-diag.
      gruende.push(`${r.set_number}: als fehlend bekannt` +
                   (grundFuer('set:' + r.set_number) ? ` (${grundFuer('set:' + r.set_number)})` : ''));
      continue;
    }

    // ── Zwischen zwei Anfragen warten ──────────────────────────────────────
    //
    // NICHT vor der ersten: Der erste Durchgang soll nicht künstlich später
    // beginnen. Die Pause gehört ZWISCHEN die Anfragen.
    //
    // Sie steht hier und nicht um den ganzen Schleifenkörper, weil Sets mit
    // bereits vorhandener Datei oben abgekürzt werden — die kosten den CDN
    // nichts und sollen auch nichts kosten.
    await pauseVorArbeit();
    arbeit++;

    const info: { status?: number } = {};
    const lokal = await downloadSetImage(r.url, r.set_number, info).catch(() => null);
    if (!lokal) {
      // ── Drosselung ist KEINE Fehlanzeige ─────────────────────────────────
      //
      // Marcos Frage: „Können so viele Requests abgefragt werden, oder wird da
      // Cloudflare die IP sperren?"
      //
      // Beim Nachsehen fiel auf: Bisher galt jeder Fehlschlag als „dieses Bild
      // gibt es nicht" — auch ein 403 oder 429. Gerade bei einer Drosselung
      // sind die Bilder aber VORHANDEN, und der Ansturm, der sie auslöst,
      // hätte hunderte davon für sieben Tage ausgesperrt.
      //
      // Deshalb: Nur ein 404 wird gemerkt. Bei 403/429 legt der Job eine Pause
      // ein und gibt die restlichen Notizen zurück in die Warteschlange — sie
      // sind ja schon gelöscht, also neu einreihen.
      if (info.status === 403 || info.status === 429) {
        _pauseBis = Date.now() + DROSSEL_PAUSE_MS;
        console.error(`[image-queue] CDN drosselt (HTTP ${info.status}) — Pause bis ` +
                      new Date(_pauseBis).toLocaleTimeString());
        // ALLE noch unbearbeiteten Notizen zurücklegen, nicht nur diese eine.
        //
        // Der Stapel wird mit DELETE … RETURNING geholt — die Zeilen sind also
        // bereits aus der Warteschlange verschwunden. Legte man beim Abbruch
        // nur die aktuelle zurück, verlöre man den ganzen Rest des Stapels
        // still. (Genau das ist mir beim ersten Entwurf passiert: 10 Notizen
        // rein, nach der Drosselung war 1 übrig.)
        const rest = rows.slice(idx);
        await db.run(
          `INSERT INTO image_wanted (url, set_number)
             SELECT * FROM unnest($1::text[], $2::text[])
             ON CONFLICT (url) DO NOTHING`,
          [rest.map((x: any) => x.url), rest.map((x: any) => x.set_number)]).catch(() => {});
        erg.zurueckgelegt = rest.length;
        break;
      }
      // ── NUR ein 404 heisst „das Bild gibt es nicht" (Nachtrag 123) ───────
      //
      // Marcos Log: „2 als fehlend bekannt" — die beiden Bilder standen in
      // image_misses und wurden deshalb gar nicht mehr versucht. Wie kamen sie
      // dorthin?
      //
      // Bis hierher merkte sich der Job JEDEN Fehlschlag ausser 403/429: eine
      // Zeitüberschreitung, einen DNS-Aussetzer, eine abgebrochene Verbindung,
      // „Antwort zu klein", „zu viele Weiterleitungen", ein zu grosses Bild —
      // und über den umgebenden catch sogar einen Schreibfehler auf der
      // eigenen Platte. Alles davon sperrte das Bild SIEBEN TAGE aus, und von
      // aussen war nicht zu erkennen, dass es je einen Versuch gab.
      //
      // Der Bild-Proxy macht es längst richtig und begründet es sogar im Code:
      // dort wird nur bei 404 gemerkt. Zwei Bauteile, dieselbe Tabelle, zwei
      // verschiedene Auslegungen von „fehlend" — wieder „Regel fehlt am
      // zweiten Weg", diesmal als Widerspruch statt als Lücke.
      //
      // Ein vorübergehender Fehler führt jetzt zu KEINEM Vermerk. Die Notiz ist
      // ohnehin verbraucht; entsteht sie über den Proxy neu, wird es erneut
      // versucht — das ist genau das gewünschte Verhalten für „geht gerade
      // nicht".
      const hartFehlend = info.status === 404 || info.status === 410;
      if (hartFehlend) merkeFehlend('set:' + r.set_number, `HTTP ${info.status} vom CDN`);
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
  // ── Zurückgelegte Zeilen sind NICHT bearbeitet (Nachtrag 122) ────────────
  //
  // Nach einer Drosselung wandern die restlichen Notizen zurück in die
  // Warteschlange. `rows.length` meldete sie trotzdem als bearbeitet — bei
  // einem Stapel, der schon an der ERSTEN Zeile abbricht, stand da „2
  // bearbeitet", obwohl null Zeilen verbraucht und zwei zurückgelegt wurden.
  erg.gesamt = rows.length - erg.zurueckgelegt;
  erg.arbeit = arbeit;
  // ── Die Betroffenen beim Namen nennen ────────────────────────────────────
  //
  // Eine Zahl sagt „zwei sind gescheitert", nicht WELCHE. Genau das fehlte
  // Marco, um weiterzukommen: Mit der Setnummer beantwortet
  // GET /api/v1/admin/image-diag/:setNumber die Frage in EINER Antwort.
  // Nur bei wenigen Fällen — bei fünfzig wäre die Zeile unlesbar, und die
  // Einzelgründe stehen ohnehin in den [set-img]- und [thumb]-Zeilen.
  if (gruende.length && gruende.length <= 5) {
    console.error(`[image-queue] ${gruende.join(' · ')}`);
  }
  // HIER festhalten, nicht erst im Takt: Wer diesen Stapel ausführt, hat
  // gearbeitet — gleich, von wo er gerufen wurde. In die DATENBANK schreibt
  // erst der Takt (speichereLauf).
  merkeLauf(erg);
  return erg;
}

/**
 * Die Notizen abarbeiten — nur auf dem Primärprozess.
 *
 * Das Wegschreiben des Puffers steht bewusst NICHT hier, sondern in
 * initImageQueue(): Der Puffer ist je Prozess, das Abarbeiten ist es nicht.
 */
/**
 * Ein Takt: Stapel nachholen, bis das Kontingent für echte Arbeit aufgebraucht
 * ist, die Warteschlange leer ist oder der Deckel greift.
 *
 * Der Abbruch hängt an `arbeit`, nicht an `gesamt` — siehe die Begründung bei
 * DURCHGANG_MAX_NOTIZEN. Für Marcos Fall („10 bereits vorhanden", fünfmal
 * hintereinander) heisst das: Statt fünf Takte über hundert Sekunden räumt ein
 * einziger Takt bis zu fünfhundert fertige Notizen ab.
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
