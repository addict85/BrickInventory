/**
 * Die Fassung der Schnittstelle /api/v1 — und die kleinste App-Fassung, mit
 * der dieser Server noch zusammenarbeitet. Jede Antwort trägt beide als
 * Kopfzeile; die App vergleicht mit ihrer eigenen (util/ApiVersion.kt) und
 * sagt dem Nutzer, wer aktualisieren muss. Erhöhen nur bei einer Änderung,
 * die das Gegenstück bricht.
 */
export const API_VERSION = 1;
export const API_MIN_APP = 1;
