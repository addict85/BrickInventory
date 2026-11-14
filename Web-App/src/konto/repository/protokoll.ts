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
    `INSERT INTO verwaltungsprotokoll (verwalter_id, ziel_id, ziel_name, aktion, einzelheiten)
     VALUES ($1, $2, (SELECT username FROM users WHERE id = $2), $3, $4)`,
    [verwalterId, zielId, aktion, einzelheiten],
  );
  console.log(`[verwaltung] Konto ${verwalterId}: ${aktion} für Konto ${zielId}`);
}

export async function letzteEintraege(db: DbSchnittstelle, anzahl = 200) {
  return db.all<Record<string, unknown>>(
    `SELECT p.id, p.zeit, p.aktion, p.einzelheiten, p.ziel_id, p.ziel_name, p.verwalter_id, u.username AS verwalter_name
       FROM verwaltungsprotokoll p LEFT JOIN users u ON u.id = p.verwalter_id
      ORDER BY p.zeit DESC, p.id DESC LIMIT $1`,
    [anzahl],
  );
}

/** Ein Jahr genügt zum Nachvollziehen; der Name eines gelöschten Kontos bleibt bis zum
 * nächsten Lauf lesbar (wer wurde gelöscht?), danach nur die Kennung. */
export const PROTOKOLL_FRIST_TAGE = 365;
export async function raeumeProtokollAuf(db: DbSchnittstelle, tage = PROTOKOLL_FRIST_TAGE): Promise<number> {
  const alt =
    (await db.run('DELETE FROM verwaltungsprotokoll WHERE zeit < NOW() - make_interval(days => $1::int)', [tage]))
      .changes ?? 0;
  const namen =
    (
      await db.run(`UPDATE verwaltungsprotokoll p SET ziel_name = NULL
    WHERE ziel_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.ziel_id)`)
    ).changes ?? 0;
  return alt + namen;
}
