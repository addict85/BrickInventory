/**
 * Die Namensräume aller prozessübergreifenden Sperren — an EINER Stelle.
 *
 * ── Warum es diese Datei gibt (Nachtrag 149) ────────────────────────────────
 * PostgreSQL-Beratungssperren (`pg_advisory_lock`) haben keinen Namen, nur eine
 * Zahl. Zwei Vorgänge mit derselben Zahl sperren sich gegenseitig aus, obwohl
 * sie nichts miteinander zu tun haben — und man merkt es nicht am Fehler,
 * sondern daran, dass etwas manchmal nicht läuft.
 *
 * Die Zahlen lagen als Konstanten in sechs Dateien verteilt, jede mit einem
 * Kommentar der Art „belegt sind bereits: 42, 56, 57, …". Solche Listen sind
 * Abschriften: Sie stimmen am Tag, an dem man sie schreibt. Die Liste in
 * jobs/priceJob.ts nannte fünf Namensräume und kannte 58 nicht; der Test in
 * test/rate-limit.test.js prüfte gegen vier und kannte 55, 56, 57 und 58
 * nicht — er hätte eine Kollision mit dreien davon durchgelassen.
 *
 * Jetzt gibt es die Zahlen nur hier. Eine Kollision ist damit nicht mehr eine
 * Frage der Sorgfalt beim Lesen fremder Kommentare, sondern beim Bearbeiten
 * DIESER Datei — und test/lock-namespaces-db.test.js hält gegen eine echte
 * Datenbank fest, dass verschiedene Namensräume sich tatsächlich nicht
 * behindern und derselbe sich sehr wohl behindert.
 *
 * ── Beim Ergänzen ──────────────────────────────────────────────────────────
 * Eine neue Zeile hier, den Namen im aufrufenden Modul importieren. Keine
 * blanke Zahl in einem `pg_*advisory*`-Aufruf — der Test verbietet sie.
 */

/**
 * Sperren mit fester Zahl. Der zweite Parameter von `pg_advisory_lock(a, b)`
 * unterteilt den Namensraum weiter (etwa je Set oder je Tabelle); wer keinen
 * braucht, übergibt 0.
 */
export const LOCKS = {
  /** Bild-Download je Set — zweiter Wert: hashtext(Setnummer). */
  BILD_DOWNLOAD:      42,
  /** Preis-Job. Läuft Minuten, deshalb Sitzungs- und keine Transaktionssperre. */
  PREIS_JOB:          55,
  /** Anleitungs-Warteschlange. */
  ANLEITUNGS_QUEUE:   56,
  /** Fehlende Bilder erneut laden ("redownload"). */
  BILDER_NACHLAUF:    57,
  /** CSV-Katalogimport — zweiter Wert: Nummer der Zieltabelle. */
  CSV_IMPORT:         58,
  /** Teile-Zusammenfassung je Nutzer — zweiter Wert: user_id. */
  TEILE_SUMMARY:      77,
  /** Brickset-Wiedervorlage. */
  BRICKSET_RETRY:     11223344,
  /** Vorschaubilder des Bild-Proxys. */
  PROXY_THUMBS:       918273645,
  /** Schema-Initialisierung — genau ein Worker migriert. */
  SCHEMA_INIT:        55667788,
  /** Wahl des Primärprozesses beim Start. */
  PRIMARY_WORKER:     99999999,
} as const;

/**
 * Der Namensraum von utils/txLock.ts ist die USER-ID selbst, nicht eine Zahl
 * aus der Liste oben — dort sperrt jeder Nutzer nur gegen sich selbst.
 *
 * Damit kollidiert er im Grundsatz mit jeder festen Zahl, die zufällig einer
 * user_id entspricht. Praktisch nicht: txLock benutzt
 * `pg_advisory_xact_lock(userId, hashtext(scope))`, der zweite Wert ist also
 * ein Streuwert über den Vorgangsnamen und trifft die 0 bzw. hashtext(set) der
 * Einträge oben nicht. Es steht hier, damit die nächste Person das nicht neu
 * herleiten muss.
 */
export const TXLOCK_NAMENSRAUM_IST_DIE_USER_ID = true;
