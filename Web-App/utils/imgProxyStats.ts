/**
 * Fehlerzähler des Bild-Proxys.
 *
 * Abrufbar über GET /api/v1/admin/img-probe (Feld `failures`).
 *
 * ── Warum ein eigenes Modul (Nachtrag 129) ──────────────────────────────────
 *
 * Der Zähler lag als Closure in registerImgProxy() und wurde für die
 * Monitoring-Route über `(global as any).__imgProxyFailures` hinausgereicht.
 * Das war der einzige Weg, weil ein Closure-Wert von aussen nicht erreichbar
 * ist — mit dem Aufteilen der Funktion braucht ihn nun aber auch
 * utils/proxyThumbs.ts, und ein zweiter Zugriff über `global` wäre ein zweiter
 * ungeprüfter Umweg gewesen.
 *
 * Als Modul ist er ein gewöhnlicher Import: tsc kennt die Felder, und der
 * globale Ablageplatz entfällt.
 *
 * Der Zähler ist PROZESSLOKAL, und das ist hier richtig: Er beantwortet „womit
 * scheitert der Proxy gerade", nicht „wie viele Fehler gab es insgesamt". Wer
 * Letzteres will, braucht die Datenbank — siehe die Job-Überwachung.
 *
 * Grund für seine Existenz: „Bilder erscheinen teilweise nicht" liess sich
 * mehrfach nicht eingrenzen, weil im Log nichts stand. Jetzt ist ablesbar, OB
 * und WOMIT der Proxy scheitert — Zeitüberschreitung, Verbindungsfehler oder
 * 404 vom CDN.
 */
export const imgProxyFailures = {
  timeout: 0,
  error: 0,
  notFound: 0,
  other: 0,
  lastError: null as string | null,
};
