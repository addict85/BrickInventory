/**
 * Protokoll der Verwalteraktionen an fremden Konten (Migration 0049).
 */
import * as db from '../db/database';

export type VerwalterAktion = 'konto_angelegt' | 'passwort_gesetzt' | 'zweiter_faktor_entfernt'
  | 'verwalter_ernannt' | 'verwalter_entzogen' | 'konto_geloescht';

/** Vor dem Löschen aufrufen — danach ist der Name nicht mehr zu ermitteln. */
export async function protokolliere(verwalterId: number, zielId: number, aktion: VerwalterAktion): Promise<void> {
  await db.run(
    `INSERT INTO verwaltungsprotokoll (verwalter_id, ziel_id, ziel_name, aktion)
     VALUES ($1, $2, (SELECT username FROM users WHERE id = $2), $3)`,
    [verwalterId, zielId, aktion]);
  console.log(`[verwaltung] Konto ${verwalterId}: ${aktion} für Konto ${zielId}`);
}

export async function letzteEintraege(anzahl = 200) {
  return db.all(
    `SELECT p.id, p.zeit, p.aktion, p.ziel_id, p.ziel_name, p.verwalter_id, u.username AS verwalter_name
       FROM verwaltungsprotokoll p LEFT JOIN users u ON u.id = p.verwalter_id
      ORDER BY p.zeit DESC, p.id DESC LIMIT $1`, [anzahl]);
}
