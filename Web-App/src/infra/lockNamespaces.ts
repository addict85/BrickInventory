/** An EINER Stelle, damit zwei Sperren nie dieselbe Zahl tragen. */

/** Der zweite Parameter von `pg_advisory_lock(a, b)` unterteilt weiter; wer
 * keinen braucht, übergibt 0. */
export const LOCKS = {
  /** Zweiter Wert: hashtext(Setnummer). */
  IMAGE_DOWNLOAD: 42,
  /** Zweiter Wert: hashtext(art). Steht als Zahl im Trigger aus Migration 0099. */
  AUFTRAG_EXKLUSIV: 59,
  /** Haushaltswährung und Verknüpfung prüfen dieselbe Regel; zweiter Wert 0. */
  HOUSEHOLD_CURRENCY: 62,
  /** Zweiter Wert: hashtext(Prozesskennung); hält jeder Job-Prozess, solange er lebt. */
  JOB_PROCESS: 63,
  /** Läuft Minuten, deshalb Sitzungs- und keine Transaktionssperre. */
  PRICE_JOB: 55,
  ANLEITUNGS_QUEUE: 56,
  IMAGES_FOLLOW_UP: 57,
  /** Zweiter Wert: Nummer der Zieltabelle. */
  CSV_IMPORT: 58,
  /** Zweiter Wert: user_id. */
  PARTS_SUMMARY: 77,
  PARTS_CATALOG: 79,
  /** Alles, was Verwalter entzieht, deaktiviert oder löscht; zweiter Wert 0. */
  ADMIN_INVENTORY: 81,
  /** Zweiter Wert: hashtext('<user_id>|<schlüssel>'). */
  INVENTORY: 61,
  /** Zweiter Wert: hashtext(Setnummer); „schon im Blickfeld?“ und Anlegen in einem Schritt. */
  SET_ADD: 64,
  /** Hält der eine Web-Prozess, solange er lebt (startup/singleInstance.ts); zweiter Wert 0. */
  WEB_PROCESS: 65,
  PROXY_THUMBS: 918273645,
  SCHEMA_INIT: 55667788,
} as const;
