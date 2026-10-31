import * as db from '../../../db/database';

/** Geheimnisse aus der Zeit vor der Verschlüsselung: Gutschein-PINs und Schlüssel des zweiten Faktors. */

export type Kandidat = { art: 'pin' | 'faktor'; k: number; v: string | null };

export async function klartextKandidaten(): Promise<Kandidat[]> {
  return [
    ...(await db.all<{ k: number; v: string | null }>('SELECT id AS k, pin AS v FROM vouchers WHERE pin IS NOT NULL'))
      .map(z => ({ art: 'pin' as const, ...z })),
    ...(await db.all<{ k: number; v: string | null }>('SELECT user_id AS k, geheimnis AS v FROM zweiter_faktor'))
      .map(z => ({ art: 'faktor' as const, ...z })),
  ];
}

/** `AND … = $3`: Hat ein anderer Prozess die Zeile inzwischen geändert, bleibt sie. @returns geänderte Zeilen */
export async function ersetzeGeheimnis(art: Kandidat['art'], k: number, alt: string, neu: string | null): Promise<number> {
  const sql = art === 'pin'
    ? 'UPDATE vouchers SET pin = $1 WHERE id = $2 AND pin = $3'
    : 'UPDATE zweiter_faktor SET geheimnis = $1 WHERE user_id = $2 AND geheimnis = $3';
  return (await db.run(sql, [neu, k, alt])).changes || 0;
}
