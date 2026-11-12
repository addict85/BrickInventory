import type { DbSchnittstelle } from '../../../db/database';

export const PRICE_CACHE_COLS = 'set_number, condition, min_price, avg_price, max_price, qty_avg_price, fetched_at';

/** numeric kommt aus dem Treiber als Text. */
export interface SetPreiszeile {
  set_number: string;
  condition: string;
  min_price: number | null;
  avg_price: number | null;
  max_price: number | null;
  qty_avg_price: number | null;
  fetched_at: Date | null;
}
/** NUMERIC kommt als Zahl an (db/database.ts). */
export interface Preiszeile {
  avg_price: number | null;
  qty_avg_price: number | null;
  condition: string;
  fetched_at: Date | null;
}

/** `dbh` erlaubt das Lesen in einer offenen Transaktion. */
export function setZustandsZaehler(
  db: DbSchnittstelle,
  uids: number[],
  setNumber: string,
  dbh: Pick<DbSchnittstelle, 'get'> = db,
) {
  return dbh.get<{ acq_count: string; used_count: string }>(
    `SELECT COUNT(a.id)                                 AS acq_count,
            COUNT(a.id) FILTER (WHERE a.condition='U')  AS used_count
       FROM sets s LEFT JOIN set_acquisitions a
         ON a.user_id = s.user_id AND a.set_number = s.set_number
      WHERE s.user_id = ANY($1) AND s.set_number=$2`,
    [uids, setNumber],
  );
}

export async function loescheAlleSetPreise(db: DbSchnittstelle): Promise<void> {
  await db.run('DELETE FROM price_cache');
}

export function setPreisFrisch(
  db: DbSchnittstelle,
  setNumber: string,
  condition: string,
  currency: string,
  ttlStunden: number,
) {
  return db.get<SetPreiszeile>(
    `SELECT ${PRICE_CACHE_COLS} FROM price_cache
      WHERE set_number = $1 AND condition = $2 AND currency_code = $3
        AND fetched_at > NOW() - make_interval(hours => $4)`,
    [setNumber, condition, currency, ttlStunden],
  );
}

export function setPreiseFrisch(db: DbSchnittstelle, setNumbers: string[], currency: string, ttlStunden: number) {
  return db.all<SetPreiszeile>(
    `SELECT ${PRICE_CACHE_COLS} FROM price_cache
       WHERE set_number = ANY($1) AND currency_code = $2 AND fetched_at > NOW() - make_interval(hours => $3)`,
    [setNumbers, currency, ttlStunden],
  );
}

export interface SetPreis {
  min: number;
  avg: number;
  max: number;
  qavg: number;
  qty: number;
}

/** Auch eine Antwort ohne Preis: Sie hält den nächsten Abruf zurück. */
export function merkeSetPreis(
  db: DbSchnittstelle,
  setNumber: string,
  condition: string,
  currency: string,
  p: SetPreis,
) {
  return db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET min_price=$4,avg_price=$5,max_price=$6,qty_avg_price=$7,total_quantity=$8,fetched_at=NOW()`,
    [setNumber, condition, currency, p.min, p.avg, p.max, p.qavg, p.qty],
  );
}

export function merkeSetVerlauf(
  db: DbSchnittstelle,
  setNumber: string,
  condition: string,
  currency: string,
  p: SetPreis,
) {
  return db.run(
    'INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
    [setNumber, condition, currency, p.avg, p.qavg, p.min, p.max],
  );
}

export function blFarben(db: DbSchnittstelle) {
  return db.all<{ id: number; bl_color_id: number }>(
    'SELECT id, bl_color_id FROM rb_colors WHERE bl_color_id IS NOT NULL',
  );
}

export function teilepreiseFrisch(
  db: DbSchnittstelle,
  nummern: string[],
  farben: number[],
  currency: string,
  ttlStunden: number,
) {
  return db.all<Preiszeile & { part_number: string; color_id: number }>(
    `SELECT c.part_number, c.color_id, c.condition, c.avg_price, c.qty_avg_price, c.fetched_at
       FROM part_price_cache c
       JOIN unnest($1::text[], $2::int[]) AS k(nr, farbe)
         ON c.part_number = k.nr AND c.color_id = k.farbe
      WHERE c.currency_code = $3 AND c.fetched_at > NOW() - make_interval(hours => $4)`,
    [nummern, farben, currency, ttlStunden],
  );
}

/** Nur echte, keine geschätzten. */
export function figurenpreiseFrisch(db: DbSchnittstelle, figuren: string[], currency: string, ttlStunden: number) {
  return db.all<Preiszeile & { fig_number: string }>(
    `SELECT fig_number, condition, avg_price, qty_avg_price, fetched_at FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2 AND NOT geschaetzt
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [figuren, currency, ttlStunden],
  );
}

export function teilpreisFrisch(
  db: DbSchnittstelle,
  blPartNumber: string,
  blColorId: number,
  condition: string,
  currency: string,
  ttlStunden: number,
) {
  return db.get<Preiszeile>(
    `SELECT avg_price, qty_avg_price FROM part_price_cache WHERE part_number=$1 AND color_id=$2 AND condition=$3 AND currency_code=$4 AND fetched_at > NOW() - make_interval(hours => $5)`,
    [blPartNumber, blColorId, condition, currency, ttlStunden],
  );
}

export function figurpreisFrisch(
  db: DbSchnittstelle,
  figNumber: string,
  condition: string,
  currency: string,
  ttlStunden: number,
) {
  return db.get<Preiszeile>(
    `SELECT avg_price, qty_avg_price FROM minifig_price_cache WHERE fig_number=$1 AND condition=$2 AND currency_code=$3 AND NOT geschaetzt AND fetched_at > NOW() - make_interval(hours => $4)`,
    [figNumber, condition, currency, ttlStunden],
  );
}

export function merkeTeilpreis(
  db: DbSchnittstelle,
  blPartNumber: string,
  blColorId: number,
  condition: string,
  currency: string,
  avg: number,
  qavg: number,
) {
  return db.run(
    `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (part_number,color_id,condition,currency_code)
        DO UPDATE SET avg_price=$5, qty_avg_price=$6, fetched_at=NOW()`,
    [blPartNumber, blColorId, condition, currency, avg, qavg],
  );
}

export function merkeTeilVerlauf(
  db: DbSchnittstelle,
  blPartNumber: string,
  blColorId: number,
  condition: string,
  currency: string,
  avg: number,
  qavg: number,
) {
  return db.run(
    `INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [blPartNumber, blColorId, condition, currency, avg, qavg],
  );
}

/** Ein echter BrickLink-Preis ersetzt eine frühere Schätzung. */
export function merkeFigurpreis(
  db: DbSchnittstelle,
  figNumber: string,
  condition: string,
  currency: string,
  avg: number,
  qavg: number,
) {
  return db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fig_number,condition,currency_code)
        DO UPDATE SET avg_price=$4, qty_avg_price=$5, fetched_at=NOW(), geschaetzt=FALSE, abdeckung=NULL`,
    [figNumber, condition, currency, avg, qavg],
  );
}

export function merkeFigurVerlauf(
  db: DbSchnittstelle,
  figNumber: string,
  condition: string,
  currency: string,
  avg: number,
  qavg: number,
) {
  return db.run(
    `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [figNumber, condition, currency, avg, qavg],
  );
}
