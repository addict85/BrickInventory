/**
 * Die Ablaufzeit einer Sitzung muss nicht bei JEDER Anfrage neu geschrieben
 * werden.
 *
 * ── Was gemessen wurde ──────────────────────────────────────────────────────
 *
 * Zwanzig Anfragen mit Sitzungs-Cookie, Abfragen am Verbindungs-Pool gezählt:
 *
 *     20x SELECT sess FROM user_sessions WHERE sid = $1 AND expire >= …
 *     20x UPDATE user_sessions SET expire = … WHERE sid = $1
 *
 * Also zwei Umläufe je Anfrage — und das gilt für JEDE Anfrage der Webapp,
 * auch für jedes einzelne Bild einer Galerie. Bei sechzig Kacheln sind das
 * hundertzwanzig Abfragen allein für die Sitzung, davon sechzig SCHREIBEND,
 * auf eine Tabelle, die sich alle Cluster-Worker teilen.
 *
 * Mit dieser Drosselung: 2,0 → 1,1 Abfragen je Anfrage. Die Schreibvorgänge
 * sind weg bis auf einen je Sitzung und Frist.
 *
 * ── Was NICHT gedrosselt wird ───────────────────────────────────────────────
 *
 * Das LESEN bleibt. Es ist der Sinn eines gemeinsamen Sitzungsspeichers, und
 * ein Zwischenspeicher je Worker liesse eine abgemeldete Sitzung überleben:
 * revokeAllSessions() löscht die Zeile, ein Worker mit Gedächtnis bemerkte das
 * nicht. Genau der Fall, für den es die Funktion gibt.
 *
 * ── Warum das Schreiben warten darf ─────────────────────────────────────────
 *
 * express-session ruft touch() bei jeder Anfrage auf, um den Ablauf nach
 * hinten zu schieben. Die Lebensdauer beträgt einen TAG (Voreinstellung von
 * connect-pg-simple, da kein cookie.maxAge gesetzt ist). Ob der Ablauf auf die
 * Sekunde genau nachgeführt wird oder alle fünf Minuten, ändert daran nichts:
 * Im schlimmsten Fall läuft eine Sitzung fünf Minuten früher ab als nötig —
 * bei einem Tag Laufzeit.
 *
 * Dieselbe Entscheidung steht schon in utils/auth.ts für die Tokens:
 * LAST_USED_THROTTLE, „last_used max. alle 5 Min schreiben". Gleiches Problem,
 * gleiche Antwort, gleiche Frist.
 *
 * ── Wer das nicht zahlt ─────────────────────────────────────────────────────
 *
 * Die Android-App: Sie kommt mit Bearer-Token und ohne Cookie, und dann fasst
 * express-session den Speicher gar nicht erst an — nachgemessen 0 Abfragen bei
 * 20 Anfragen ohne Cookie.
 */

/** Frist zwischen zwei geschriebenen Ablaufzeiten derselben Sitzung. */
export const BERUEHREN_MS = 5 * 60 * 1000;

/**
 * Deckel gegen unbegrenztes Wachstum. Beim Überlaufen wird geleert statt
 * einzeln aufgeräumt — dieselbe Entscheidung wie bei _tokenCache in
 * utils/auth.ts. Ein verworfener Eintrag kostet genau ein zusätzliches UPDATE.
 */
const MAX_SITZUNGEN = 1000;

/** Ein Sitzungsspeicher, so viel wie hier gebraucht wird. */
interface Speicher {
  touch?: (sid: string, sess: unknown, cb?: (err?: unknown) => void) => void;
}

/**
 * Die touch()-Methode eines Sitzungsspeichers drosseln — an Ort und Stelle.
 *
 * Gibt denselben Speicher zurück, damit der Aufruf in die Konfiguration passt.
 * Hat der Speicher gar kein touch() (nicht jeder hat eines), bleibt er
 * unverändert.
 *
 * Im Cluster hat jeder Worker seine eigene Liste — im schlimmsten Fall
 * schreibt also jeder Worker einmal je Frist. Das ist gewollt: Eine geteilte
 * Liste wäre wieder ein Umlauf zur Datenbank, also genau das, was hier
 * eingespart werden soll.
 */
export function drossleBeruehren<T extends Speicher>(speicher: T, frist = BERUEHREN_MS): T {
  const echt = speicher.touch?.bind(speicher);
  if (!echt) return speicher;

  const zuletzt = new Map<string, number>();
  speicher.touch = function (sid: string, sess: unknown, cb?: (err?: unknown) => void) {
    const jetzt = Date.now();
    const vorher = zuletzt.get(sid);
    if (vorher !== undefined && jetzt - vorher < frist) return cb?.();
    if (zuletzt.size >= MAX_SITZUNGEN) zuletzt.clear();
    zuletzt.set(sid, jetzt);
    return echt(sid, sess, cb);
  };
  return speicher;
}
