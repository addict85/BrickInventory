import type { DbSchnittstelle } from '../../../db/database';

export function figurenDesSetkatalogs(db: DbSchnittstelle, setNumber: string) {
  return db.all<{ fig_number: string; fig_name: string | null; quantity: number | null; image_url: string | null }>(`SELECT fig_number, fig_name, quantity, image_url
       FROM set_minifigs_catalog
      WHERE set_number = $1`, [setNumber]);
}

export function fuegeSetFigurenEin(tx: DbSchnittstelle, userId: number, setNumber: string, nummern: string[]) {
  return tx.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source)
       SELECT $1, $2, f, 'set' FROM unnest($3::text[]) AS f ON CONFLICT DO NOTHING`, [userId, setNumber, nummern]);
}

export function entferneFremdeSetFiguren(tx: DbSchnittstelle, userId: number, setNumber: string, nummern: string[]) {
  return tx.run(`DELETE FROM minifigs WHERE user_id=$1 AND set_number=$2 AND source='set' AND NOT (fig_number = ANY($3::text[]))`, [userId, setNumber, nummern]);
}

export function fuegeSetTeileEin(tx: DbSchnittstelle, userId: number, n: string, teile: string[], farben: number[]) {
  return tx.run(`INSERT INTO parts (user_id, set_number, part_number, color_id)
           SELECT $1, $2, p, f FROM unnest($3::text[], $4::int[]) AS x(p, f) ON CONFLICT DO NOTHING`, [userId, n, teile, farben]);
}

export function entferneFremdeSetTeile(tx: DbSchnittstelle, userId: number, n: string, teile: string[], farben: number[]) {
  return tx.run(`DELETE FROM parts WHERE user_id=$1 AND set_number=$2 AND source='set'
              AND (part_number, color_id) NOT IN (SELECT * FROM unnest($3::text[], $4::int[]))`, [userId, n, teile, farben]);
}

export function teileOhneBlZuordnung(db: DbSchnittstelle) {
  return db.all<{ part_number: string }>(`SELECT DISTINCT p.part_number FROM parts p
       LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = p.part_number
       WHERE m.rb_id IS NULL
         AND p.part_number IS NOT NULL
         AND p.source != 'manual'
       LIMIT 5000`);
}
