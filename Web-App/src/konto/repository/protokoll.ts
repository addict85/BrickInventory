/**
 * Protokoll der Verwalteraktionen an fremden Konten (Migration 0049).
 */
import type { DbSchnittstelle } from '../../../db/database';

export type VerwalterAktion =
  | 'konto_angelegt'
  | 'passwort_gesetzt'
  | 'zweiter_faktor_entfernt'
  | 'verwalter_ernannt'
  | 'verwalter_entzogen'
  | 'konto_geloescht'
  | 'konto_deaktiviert'
  | 'konto_reaktiviert'
  | 'konto_freigeschaltet'
  | 'einstellungen_geaendert'
  | 'gutschein_klartext'
  | 'gutschein_pdf'
  | 'gutschein_export'
  | 'uebernahme_angekuendigt'
  | 'uebernahme_abgebrochen';

/** Vor dem Löschen aufrufen — danach ist der Name nicht mehr zu ermitteln. */
export async function protokolliere(
  db: DbSchnittstelle,
  verwalterId: number,
  zielId: number,
  aktion: VerwalterAktion,
  einzelheiten: string | null = null,
): Promise<void> {
  await db.run(
    `INSERT INTO admin_log (admin_id, target_id, target_name, action, details)
     VALUES ($1, $2, (SELECT username FROM users WHERE id = $2), $3, $4)`,
    [verwalterId, zielId, aktion, einzelheiten],
  );
  console.log(`[verwaltung] Konto ${verwalterId}: ${aktion} für Konto ${zielId}`);
}

export async function letzteEintraege(db: DbSchnittstelle, anzahl = 200) {
  return db.all<Record<string, unknown>>(
    `SELECT p.id, p.occurred_at, p.action, p.details, p.target_id, p.target_name, p.admin_id, u.username AS verwalter_name
       FROM admin_log p LEFT JOIN users u ON u.id = p.admin_id
      ORDER BY p.occurred_at DESC, p.id DESC LIMIT $1`,
    [anzahl],
  );
}

/** UPDATE und DELETE hat keine Rolle der App (0117): Frist (ein Jahr) und Regel stehen fest in
 * der Funktion der Eigentümerin. */
export async function raeumeProtokollAuf(db: DbSchnittstelle): Promise<number> {
  return (await db.get<{ n: number }>('SELECT verwaltungsprotokoll_aufraeumen() AS n'))?.n ?? 0;
}
