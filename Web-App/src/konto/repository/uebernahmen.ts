import type { DbSchnittstelle } from '../../../db/database';

export type UebernahmeArt = 'passwort' | 'zweiter_faktor';
export interface Uebernahme {
  ziel_id: number;
  art: UebernahmeArt;
  durch_id: number;
  passwort_hash: string | null;
}

export async function kuendigeAn(db: DbSchnittstelle, u: Uebernahme, stunden: number): Promise<Date> {
  const r = await db.get<{ wirksam_ab: Date }>(
    `INSERT INTO verwalter_uebernahmen (ziel_id, art, durch_id, passwort_hash, wirksam_ab)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5))
     ON CONFLICT (ziel_id, art) DO UPDATE SET durch_id = EXCLUDED.durch_id, passwort_hash = EXCLUDED.passwort_hash,
       angelegt_am = NOW(), wirksam_ab = EXCLUDED.wirksam_ab
     RETURNING wirksam_ab`,
    [u.ziel_id, u.art, u.durch_id, u.passwort_hash, stunden],
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

/** Fällig und vom Verwalter, der sie ankündigte, noch getragen; die übrigen fallen weg. */
export async function nimmFaellige(db: DbSchnittstelle): Promise<{ gilt: Uebernahme[]; verworfen: number }> {
  const weg = await db.all<Uebernahme & { gilt: boolean }>(
    `DELETE FROM verwalter_uebernahmen u WHERE wirksam_ab <= NOW()
     RETURNING ziel_id, art, durch_id, passwort_hash,
       EXISTS (SELECT 1 FROM users d WHERE d.id = u.durch_id AND d.is_admin AND d.is_active) AS gilt`,
  );
  return { gilt: weg.filter(z => z.gilt), verworfen: weg.filter(z => !z.gilt).length };
}

export async function brichUebernahmenAb(db: DbSchnittstelle, ziel: number): Promise<UebernahmeArt[]> {
  const r = await db.all<{ art: UebernahmeArt }>('DELETE FROM verwalter_uebernahmen WHERE ziel_id = $1 RETURNING art', [
    ziel,
  ]);
  return r.map(z => z.art);
}
