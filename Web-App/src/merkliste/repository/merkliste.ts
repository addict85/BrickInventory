import type { DbSchnittstelle } from '../../../db/database';
import { LIKE_ESCAPE, enthaeltMuster } from '../../../db/likeSuche';
import { ausTabelle } from '../../infra/validate';

export function merkeSetVor(db: DbSchnittstelle, userId: number, sn: string, c: string, seit: Date | string | null) {
  return db.get<{ war_neu: boolean }>(`INSERT INTO wanted (user_id, set_number, condition, created_at)
     VALUES ($1,$2,$3, COALESCE($4::timestamptz, NOW()))
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wanted.condition
     RETURNING (xmax = 0) AS war_neu`, [userId, sn, c, seit]);
}

export function streicheVormerkung(db: DbSchnittstelle, userId: number, setNumber: string, c: string) {
  return db.run('DELETE FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [userId, setNumber, c]);
}

export function istVorgemerkt(db: DbSchnittstelle, zuId: number, sn: string, c: string) {
  return db.get('SELECT 1 FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [zuId, sn, c]);
}

export function uebertrageVormerkung(db: DbSchnittstelle, zuId: number, vonId: number, sn: string, c: string) {
  return db.run('UPDATE wanted SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4', [zuId, vonId, sn, c]);
}

/** Dieselben Namen wie SET_SORTS: Beide Oberflächen beschriften sie gleich. */
const MERK_SORTS = {
  added_desc: 'w.created_at DESC',
  added_asc:  'w.created_at ASC',
  name_asc:   'rb.name ASC NULLS LAST',
  num_asc:    'w.set_number ASC',
  year_desc:  'rb.year DESC NULLS LAST',
  price_desc: 'pc.avg_price DESC NULLS LAST',
  price_asc:  'pc.avg_price ASC NULLS LAST',
};

export interface MerkAuswahl { nurSet: string | null; suche: string | null; zustand: 'N' | 'U' | null; sortierung: unknown }

export function merklisteImBlickfeld(db: DbSchnittstelle, userIds: number[], f: MerkAuswahl, waehrung: string) {
  const werte: unknown[] = [userIds];
  let wo = '';
  if (f.nurSet) { werte.push(f.nurSet); wo += ` AND w.set_number = $${werte.length}`; }
  // Nummer UND Name, wie in der Galerie; der Name kommt aus dem JOIN auf rb_sets.
  if (f.suche) {
    werte.push(enthaeltMuster(f.suche));
    wo += ` AND (w.set_number ILIKE $${werte.length}${LIKE_ESCAPE}`
        + ` OR rb.name ILIKE $${werte.length}${LIKE_ESCAPE})`;
  }
  if (f.zustand) { werte.push(f.zustand); wo += ` AND w.condition = $${werte.length}`; }
  // ausTabelle(): Der direkte Zugriff fände auch geerbte Eigenschaften wie „constructor".
  const ordnung = ausTabelle(MERK_SORTS, f.sortierung, MERK_SORTS.added_desc);
  werte.push(waehrung);
  const pWaehrung = `$${werte.length}`;
  return db.all(`SELECT w.set_number, w.condition, w.created_at, w.user_id,
            rb.name, rb.year, rb.theme_id, rb.num_parts,
            sc.image_url,
            pa.richtung AS alarm_richtung, pa.schwelle AS alarm_schwelle,
            pa.ausgeloest AS alarm_ausgeloest,
            pc.avg_price AS marktpreis,
            EXISTS (SELECT 1 FROM sets s
                     WHERE s.user_id = ANY($1) AND s.set_number = w.set_number) AS owned
       FROM wanted w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
       -- Das Bild steht nur in set_catalog (0108).
       LEFT JOIN set_catalog sc ON sc.set_number = w.set_number
       LEFT JOIN price_alerts pa ON pa.user_id = w.user_id
                                AND pa.set_number = w.set_number
                                AND pa.condition = w.condition
       -- Der Marktpreis im Zustand DIESES Merkpostens. Ohne die
       -- Zustandsbedingung stuende beim gebrauchten Merkposten der Neupreis —
       -- dieselbe Verwechslung, die in addSet() schon einmal einen
       -- Gebrauchtpreis als Neuzugang verbucht hat.
       LEFT JOIN price_cache pc ON pc.set_number = w.set_number
                               AND pc.condition = w.condition
                               AND pc.currency_code = ${pWaehrung}
      WHERE w.user_id = ANY($1)${wo}
      ORDER BY ${ordnung}, w.set_number, w.condition`, werte);
}

export function merklisteFuerExport(db: DbSchnittstelle, uid: number) {
  return db.all<Record<string, unknown>>(`SELECT w.set_number,
            w.condition,
            TO_CHAR(w.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS created_at
       FROM wanted w
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC, w.set_number, w.condition`, [uid]);
}
