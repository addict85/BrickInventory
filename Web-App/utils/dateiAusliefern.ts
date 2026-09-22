import type { Response } from 'express';

/**
 * Eine Datei ausliefern — und einen Fehler dabei auf die RICHTIGE Antwort
 * abbilden.
 *
 * ── Der Befund, aus dem diese Datei kam ─────────────────────────────────────
 *
 * Marcos Meldung: „Nach ein paar Mal die Anleitung abrufen aus der App
 * erscheint folgende Meldung" — „Fehler beim Laden: HTTP 404".
 *
 * Die Anleitung lag die ganze Zeit da. Der Weg dorthin:
 *
 *   1. Der PDF-Viewer der App laedt fortsetzbar: Liegt schon etwas im Cache,
 *      schickt er `Range: bytes=<vorhanden>-` und haengt den Rest an.
 *   2. Nach einem VOLLSTAENDIGEN Download ist `vorhanden` genau die
 *      Dateigroesse. Der Bereich beginnt damit HINTER dem letzten Byte.
 *   3. `send` (unter res.sendFile) beantwortet das mit 416 — korrekt: „diesen
 *      Bereich gibt es nicht".
 *   4. Die Route hier bildete JEDEN Fehler auf 404 ab. Aus „dein Bereich ist
 *      zu gross" wurde „die Datei gibt es nicht".
 *
 * NACHGEMESSEN an derselben Express- und send-Fassung, die der Server
 * benutzt (express 4.22.3, send 0.19.2), mit einer 5000-Byte-Datei:
 *
 *     ohne Range              -> 200
 *     Range bytes=0-          -> 206
 *     Range bytes=2500-       -> 206
 *     Range bytes=5000-       -> 404   ← mit dem alten Callback
 *     Range bytes=5000- ohne Callback -> 416
 *
 * Der Callback war also die einzige Ursache fuer die falsche Zahl. Die
 * eigentliche Ursache der FEHLGESCHLAGENEN ANZEIGE liegt in der App (sie
 * darf einen fertigen Download nicht fortsetzen wollen) und ist dort
 * behoben — aber eine 404 fuer eine vorhandene Datei ist fuer sich genommen
 * falsch und hat die Suche in die falsche Richtung geschickt. Beides gehoert
 * repariert, nicht nur eines.
 *
 * ── Warum nicht einfach den Callback weglassen ──────────────────────────────
 *
 * Ohne Callback antwortet Express selbst — mit einer HTML-Fehlerseite und,
 * schlimmer, indem es den Fehler an den naechsten Fehler-Handler weiterreicht.
 * Der Callback ist richtig; nur sein Inhalt war es nicht.
 */

/** Fehler, wie `send` sie erzeugt: mit einer HTTP-Zahl daran. */
type DateiFehler = Error & { status?: number; statusCode?: number; code?: string };

/**
 * Die Zahl aus einem `send`-Fehler holen. `send` benutzt `status`,
 * http-errors setzt zusaetzlich `statusCode` — beide nachsehen, damit ein
 * Fassungswechsel der Bibliothek diese Stelle nicht still unwirksam macht.
 */
function zahlAus(err: unknown): number | null {
  const e = err as DateiFehler | null | undefined;
  const n = e?.status ?? e?.statusCode;
  return typeof n === 'number' && n >= 400 && n <= 599 ? n : null;
}

/**
 * Antwort auf einen Fehler aus res.sendFile().
 *
 * Nichts tun, wenn schon etwas rausgegangen ist: Das ist der Abbruch durch den
 * Client (er legt mitten im Download auf). Eine zweite Antwort waere ein
 * Fehler im Log und nichts sonst.
 */
export function antwortAufDateiFehler(res: Response, err: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const zahl = zahlAus(err);
  // 404 bleibt 404 — und alles ohne eigene Zahl auch: Ein Fehler, den wir
  // nicht einordnen koennen, an dieser Stelle heisst fast immer „die Datei
  // ist nicht da" (ENOENT, ENOTDIR).
  if (zahl === null || zahl === 404) {
    res.status(404).send('Datei nicht gefunden');
    return;
  }
  // 416 traegt bereits ein Content-Range, das `send` vor dem Fehler gesetzt
  // hat („bytes */<laenge>"). Das bleibt stehen und sagt dem Client, wie lang
  // die Datei wirklich ist — genau die Auskunft, die er braucht.
  res.sendStatus(zahl);
}

/**
 * Datei ausliefern, Fehler richtig beantworten. Der gemeinsame Weg fuer alle
 * Routen, die nichts Besonderes tun, wenn die Datei fehlt.
 */
export function liefereDatei(res: Response, pfad: string): void {
  res.sendFile(pfad, (err?: Error) => {
    if (err) antwortAufDateiFehler(res, err);
  });
}
