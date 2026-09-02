const db = require('../db/database');

/**
 * Bilder, die es beim CDN nicht gibt — EINMAL gemerkt, für alle Prozesse.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Beim ersten Scrollen im Katalog funktioniert es einwandfrei, wenn ich dann
 * weiter scrolle zu 1958, ist es wieder das gleiche Problem." Dazu der Log:
 * seitenweise `[set-img] HTTP 404 vom Bildserver` für Sets aus den Fünfzigern
 * und Sechzigern, und `docker stats` mit 142 % CPU.
 *
 * Für alte Sets hat Rebrickable meist gar kein Bild. Jede Kachel dort löste
 * einen Roundtrip zum CDN aus, der ins Leere ging.
 *
 * ── Warum das bisher nicht abgefangen wurde ─────────────────────────────────
 * Es GAB zwei Merker: der Bild-Proxy hielt 404er fünfzehn Minuten fest, und der
 * Katalog merkte sich, welche Sets er schon versucht hatte. Beide lagen im
 * Arbeitsspeicher EINES Prozesses — und der Server läuft im Cluster mit
 * mehreren Arbeitsprozessen. Dasselbe fehlende Bild wurde deshalb einmal je
 * Prozess geholt, nach einem Neustart erneut, und nach fünfzehn Minuten wieder.
 *
 * In einem Katalogbereich, in dem fast jedes Bild fehlt, kostet das bei jedem
 * Besuch den vollen Satz Roundtrips. Genau das steht im Log.
 *
 * ── Die Lösung ──────────────────────────────────────────────────────────────
 * Eine Tabelle. Sie überlebt den Neustart, und alle Prozesse lesen dieselbe.
 * Davor ein Merker im Arbeitsspeicher, damit die häufigen Treffer nicht je
 * Bildanfrage in die Datenbank müssen.
 *
 * Nach `ERNEUT_PRUEFEN_MS` gilt ein Eintrag als veraltet und das Bild wird
 * wieder versucht — ein nachgereichtes Bild soll nicht für immer ausgesperrt
 * bleiben. Sieben Tage: Ein Bild, das seit Jahrzehnten fehlt, taucht nicht über
 * Nacht auf, und der Preis eines vergeblichen Versuchs ist einmal pro Woche
 * statt viermal je Viertelstunde.
 */

const ERNEUT_PRUEFEN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ── Warum hier KEINE Datenbankabfrage je Bild steht (Nachtrag 103) ──────────
 *
 * Die erste Fassung fragte bei JEDER Bildanfrage die Tabelle. Das war der
 * Fehler: Bildanfragen sind der häufigste Vorgang der ganzen Anwendung — eine
 * Kachelwand sind dutzende gleichzeitig. Jede belegte eine Verbindung aus dem
 * Pool (10–15 je Arbeitsprozess), und der war damit leer. Marcos Log:
 *
 *     [route-error] 500: Error: timeout exceeded when trying to connect
 *         at getStats
 *
 * Also nicht einmal die Bildanfragen selbst scheiterten, sondern eine ganz
 * andere Route, die keine Verbindung mehr bekam. Das erklärt auch seine frühere
 * Beobachtung „als könnte der Server weniger Requests gleichzeitig bearbeiten"
 * — genau das war es.
 *
 * Ich habe damit einen Nachschlag im Arbeitsspeicher durch einen in der
 * Datenbank ersetzt und dabei übersehen, WIE oft er läuft.
 *
 * Jetzt: Der Bestand liegt vollständig im Arbeitsspeicher und wird alle paar
 * Minuten aufgefrischt — eine Abfrage je Prozess und Intervall statt einer je
 * Bild. Geschrieben wird gepuffert.
 */
const AUFFRISCHEN_MS = 5 * 60 * 1000;

/** Schlüssel → Zeitpunkt der letzten Fehlanzeige (Millisekunden). */
const _vorne = new Map<string, number>();
/**
 * Schlüssel → Grund der Fehlanzeige.
 *
 * Getrennt von `_vorne`, damit istBekanntFehlend() unverändert bleibt: Es ist
 * der heisseste synchrone Pfad hier, und der Grund interessiert nur die
 * Diagnose. Wer ihn braucht, fragt grundFuer().
 */
const _gruende = new Map<string, string>();
let _bereit = false;

/** Tabelle anlegen; einmal je Prozess. */
export async function initImageMisses(): Promise<void> {
  if (_bereit) return;
  _bereit = true;
  // Die Tabelle legt db/migrations/0009-bild-tabellen.sql an. Hier wird nur
  // noch der Speicher gefüllt und der Takt gesetzt — das ist prozess-lokal und
  // muss deshalb in JEDEM Arbeitsprozess laufen.
  await auffrischen();
  // Auffrischen und Schreiben im Takt — nicht bei jeder Anfrage.
  setInterval(() => { auffrischen().catch(() => {}); }, AUFFRISCHEN_MS).unref();
  setInterval(() => { schreibePuffer().catch(() => {}); }, 10_000).unref();
}

/**
 * Ist für diesen Schlüssel kürzlich eine Fehlanzeige gekommen?
 *
 * Erst der Merker im Arbeitsspeicher, dann die Tabelle. Ein negatives Ergebnis
 * wird NICHT gemerkt — sonst müsste jede erfolgreiche Anfrage ihn wieder
 * aufräumen.
 */
/**
 * Ist für diesen Schlüssel eine Fehlanzeige bekannt?
 *
 * SYNCHRON und ohne Datenbank — siehe die Begründung oben. Die Auskunft kann
 * höchstens ein Auffrisch-Intervall alt sein; für „dieses Bild gibt es nicht"
 * ist das folgenlos.
 */
export function istBekanntFehlend(key: string): boolean {
  const vorne = _vorne.get(key);
  if (vorne === undefined) return false;
  if (Date.now() - vorne < ERNEUT_PRUEFEN_MS) return true;
  _vorne.delete(key);
  return false;
}

/** Alles aus der Tabelle in den Speicher holen. Einmal beim Start, dann im Takt. */
async function auffrischen(): Promise<void> {
  const rows = await db.all(
    `SELECT cache_key, checked_at, reason FROM image_misses
      WHERE checked_at > NOW() - ($1 || ' milliseconds')::interval`,
    [String(ERNEUT_PRUEFEN_MS)]
  ).catch(() => null);
  if (!rows) return;
  _vorne.clear(); _gruende.clear();
  for (const r of rows) {
    _vorne.set(r.cache_key, new Date(r.checked_at).getTime());
    if (r.reason) _gruende.set(r.cache_key, r.reason);
  }
}

/**
 * Eine Fehlanzeige festhalten.
 *
 * Sofort im Speicher, in die Tabelle GEPUFFERT: Ein Schwung 404er beim
 * Durchscrollen alter Jahrgänge wäre sonst ein Schwung einzelner INSERTs — und
 * damit wieder Verbindungen aus dem Pool.
 */
const _zuSchreiben = new Map<string, string>();
export function merkeFehlend(key: string, grund = ''): void {
  _vorne.set(key, Date.now());
  if (grund) _gruende.set(key, grund);
  _zuSchreiben.set(key, grund);
}

/** Warum gilt dieser Schlüssel als fehlend? Leer, wenn kein Grund vermerkt ist. */
export function grundFuer(key: string): string {
  return _gruende.get(key) || '';
}

/**
 * Eine Fehlanzeige zurücknehmen — für die Hand am Hebel.
 *
 * ── Warum es das braucht (Nachtrag 123) ─────────────────────────────────────
 * Ein Bild, das einmal als fehlend vermerkt ist, wird sieben Tage lang nicht
 * mehr versucht. Bis hierher gab es keinen Weg, das zurückzunehmen: Der Knopf
 * „Fehlende neu laden" sieht nur Zeilen mit gesetztem `image_local` an, also
 * Bilder, die schon einmal da waren. Ein Katalogbild, das nie ankam, fiel durch
 * jedes Raster — man konnte nur warten.
 *
 * Der Speicher der ANDEREN Arbeitsprozesse wird nicht angefasst; er füllt sich
 * ohnehin alle fünf Minuten neu aus der Tabelle (auffrischen() leert ihn dabei
 * vollständig). Länger als das dauert es also nicht.
 */
export async function vergissFehlend(keys?: string[]): Promise<number> {
  const r = keys?.length
    ? await db.run(`DELETE FROM image_misses WHERE cache_key = ANY($1::text[])`, [keys])
    : await db.run(`DELETE FROM image_misses`);
  if (keys?.length) for (const k of keys) { _vorne.delete(k); _gruende.delete(k); _zuSchreiben.delete(k); }
  else { _vorne.clear(); _gruende.clear(); _zuSchreiben.clear(); }
  return r?.changes || 0;
}

async function schreibePuffer(): Promise<void> {
  if (!_zuSchreiben.size) return;
  const keys = [..._zuSchreiben.keys()];
  const gruende = keys.map(k => _zuSchreiben.get(k) || '');
  _zuSchreiben.clear();
  await db.run(
    `INSERT INTO image_misses (cache_key, checked_at, reason)
       SELECT * FROM unnest($1::text[], ARRAY(SELECT NOW() FROM unnest($1::text[])), $2::text[])
       ON CONFLICT (cache_key) DO UPDATE SET checked_at = NOW(), reason = EXCLUDED.reason`,
    [keys, gruende]
  ).catch(() => { for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (k) _zuSchreiben.set(k, gruende[i] ?? ''); } });
}

/** Nur für Tests: den Merker im Arbeitsspeicher leeren. */
export function _leereVordergrund(): void { _vorne.clear(); _gruende.clear(); }
/** Nur für Tests: den Schreibpuffer sofort wegschreiben. */
export const _schreibePuffer = schreibePuffer;
/** Nur für Tests: aus der Tabelle nachladen. */
export const _auffrischen = auffrischen;
