/** An EINER Stelle, damit zwei Sperren nie dieselbe Zahl tragen.
 * Ausführlich: docs/begruendungen/src/infra/lockNamespaces.ts.md#abschnitt */

/** Der zweite Parameter von `pg_advisory_lock(a, b)` unterteilt weiter; wer
 * keinen braucht, übergibt 0. */
export const LOCKS = {
  /** Zweiter Wert: hashtext(Setnummer). */
  BILD_DOWNLOAD:      42,
  /** Zweiter Wert: hashtext(art). Steht als Zahl im Trigger aus Migration 0099. */
  AUFTRAG_EXKLUSIV:   59,
  /** Haushaltswährung und Verknüpfung prüfen dieselbe Regel; zweiter Wert 0. */
  HAUSHALT_WAEHRUNG:  62,
  /** Läuft Minuten, deshalb Sitzungs- und keine Transaktionssperre. */
  PREIS_JOB:          55,
  ANLEITUNGS_QUEUE:   56,
  BILDER_NACHLAUF:    57,
  /** Zweiter Wert: Nummer der Zieltabelle. */
  CSV_IMPORT:         58,
  /** Zweiter Wert: user_id. */
  TEILE_SUMMARY:      77,
  TEILE_KATALOG:      79,
  /** Zweiter Wert: hashtext('<user_id>|<schlüssel>'). */
  INVENTAR:           61,
  PROXY_THUMBS:       918273645,
  SCHEMA_INIT:        55667788,
} as const;
