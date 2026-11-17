import type { DbSchnittstelle } from '../../../db/database';

export type UebernahmeArt = 'passwort' | 'zweiter_faktor' | 'deaktivieren' | 'rolle_entziehen' | 'loeschen';
export interface Uebernahme {
  ziel_id: number;
  art: UebernahmeArt;
  durch_id: number;
  passwort_hash: string | null;
}

export async function kuendigeAn(
  db: DbSchnittstelle,
  u: Uebernahme,
  stunden: number,
  abbruchHash: string,
): Promise<Date> {
  const r = await db.get<{ wirksam_ab: Date }>(
    `INSERT INTO verwalter_uebernahmen (ziel_id, art, durch_id, passwort_hash, wirksam_ab, abbruch_hash)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5), $6)
     ON CONFLICT (ziel_id, art) DO UPDATE SET durch_id = EXCLUDED.durch_id, passwort_hash = EXCLUDED.passwort_hash,
       angelegt_am = NOW(), wirksam_ab = EXCLUDED.wirksam_ab, abbruch_hash = EXCLUDED.abbruch_hash
     RETURNING wirksam_ab`,
    [u.ziel_id, u.art, u.durch_id, u.passwort_hash, stunden, abbruchHash],
  );
  return r!.wirksam_ab;
}

/** Wer die Rolle eben verlor, zählt noch als Verwalter: Sonst entzöge man sie erst und übernähme dann sofort. */
export async function verwalterOderEbenGewesen(db: DbSchnittstelle, ziel: number, stunden: number): Promise<boolean> {
  const r = await db.get<{ ja: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_admin)
         OR EXISTS (SELECT 1 FROM verwaltungsprotokoll WHERE ziel_id = $1 AND aktion = 'verwalter_entzogen'
                     AND zeit > NOW() - make_interval(hours => $2)) AS ja`,
    [ziel, stunden],
  );
  return r?.ja === true;
}

/** Fällig und vom Verwalter, der sie ankündigte, noch getragen. Passwort und Faktor nicht, wenn das
 * Ziel seither deaktiviert wurde oder jetzt wird: Es könnte sich nicht mehr anmelden, um abzubrechen. */
export async function nimmFaellige(db: DbSchnittstelle): Promise<{ gilt: Uebernahme[]; verworfen: number }> {
  const weg = await db.all<Uebernahme & { gilt: boolean }>(
    `WITH weg AS (DELETE FROM verwalter_uebernahmen WHERE wirksam_ab <= NOW() RETURNING *)
     SELECT w.ziel_id, w.art, w.durch_id, w.passwort_hash,
       EXISTS (SELECT 1 FROM users d WHERE d.id = w.durch_id AND d.is_admin AND d.is_active)
       AND (w.art NOT IN ('passwort', 'zweiter_faktor') OR NOT (
         EXISTS (SELECT 1 FROM verwaltungsprotokoll p WHERE p.ziel_id = w.ziel_id
                   AND p.aktion = 'konto_deaktiviert' AND p.zeit >= w.angelegt_am)
         OR EXISTS (SELECT 1 FROM weg x WHERE x.ziel_id = w.ziel_id AND x.art = 'deaktivieren'))) AS gilt
       FROM weg w`,
  );
  return { gilt: weg.filter(z => z.gilt), verworfen: weg.filter(z => !z.gilt).length };
}

export async function brichUebernahmenAb(db: DbSchnittstelle, ziel: number): Promise<UebernahmeArt[]> {
  const r = await db.all<{ art: UebernahmeArt }>('DELETE FROM verwalter_uebernahmen WHERE ziel_id = $1 RETURNING art', [
    ziel,
  ]);
  return r.map(z => z.art);
}

/** Das Ziel zum Link aus der Mail; der Link gilt einmal, weil der Abbruch die Zeilen löscht. */
export async function zielZumAbbruch(db: DbSchnittstelle, abbruchHash: string): Promise<number | null> {
  const r = await db.get<{ ziel_id: number }>('SELECT ziel_id FROM verwalter_uebernahmen WHERE abbruch_hash = $1', [
    abbruchHash,
  ]);
  return r?.ziel_id ?? null;
}

export function angekuendigte(db: DbSchnittstelle) {
  return db.all<{ ziel_id: number; art: UebernahmeArt; wirksam_ab: Date }>(
    'SELECT ziel_id, art, wirksam_ab FROM verwalter_uebernahmen ORDER BY wirksam_ab',
  );
}
