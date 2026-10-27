/**
 * Die Namensräume aller prozessübergreifenden Sperren — an EINER Stelle.
 * Ausführlich: docs/begruendungen/utils/lockNamespaces.ts.md#abschnitt
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
  /** Bestandszeile je Nutzer (utils/txLock.ts) — zweiter Wert: hashtext('<user_id>|<schlüssel>'). */
  INVENTAR:           61,
  /** Brickset-Wiedervorlage. */
  BRICKSET_RETRY:     11223344,
  /** Vorschaubilder des Bild-Proxys. */
  PROXY_THUMBS:       918273645,
  /** Schema-Initialisierung — genau ein Worker migriert. */
  SCHEMA_INIT:        55667788,
  /** Wahl des Primärprozesses beim Start. */
  PRIMARY_WORKER:     99999999,
} as const;
