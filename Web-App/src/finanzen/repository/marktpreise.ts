import type { DbSchnittstelle } from '../../../db/database';

export type Zustand = 'N' | 'U';
type Preiszeile = { avg_price: string | null; qty_avg_price: string | null; condition: Zustand };

/** Nur echte Preise über null. */
export function setPreisAusCache(db: DbSchnittstelle, setNumber: string, zustand: string, waehrung: string) {
  return db.get<{ avg_price: string }>(`SELECT avg_price FROM price_cache
       WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 AND avg_price > 0
       ORDER BY (condition = $2) DESC LIMIT 1`, [setNumber, zustand, waehrung]);
}

export function teilErfassungsZustand(db: DbSchnittstelle, userId: number, partNumber: string, colorId: number) {
  return db.get<{ any_used: number | null; cnt: string }>(
    "SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3",
    [userId, partNumber, colorId]);
}

export function figurErfassungsZustand(db: DbSchnittstelle, userId: number, figNumber: string) {
  return db.get<{ any_used: number | null; cnt: string }>(
    "SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2",
    [userId, figNumber]);
}

export function figurenpreiseAusCache(db: DbSchnittstelle, nummern: string[], waehrung: string, ttlStunden: number) {
  return db.all<Preiszeile & { fig_number: string }>(
    `SELECT fig_number, condition, avg_price, qty_avg_price FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`, [nummern, waehrung, ttlStunden]);
}

export function teilepreiseAusCache(db: DbSchnittstelle, nummern: string[], waehrung: string, ttlStunden: number) {
  return db.all<Preiszeile & { part_number: string; color_id: number }>(
    `SELECT part_number, color_id, condition, avg_price, qty_avg_price FROM part_price_cache
      WHERE part_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`, [nummern, waehrung, ttlStunden]);
}

/** Wie geschaetzterFigurenpreis für viele Figuren in einer Abfrage; Schlüssel `nummer|zustand`. */
export async function geschaetzteFigurenpreise(db: DbSchnittstelle, figuren: string[], waehrung: string, ttlStunden: number) {
  const aus = new Map<string, { preis: number; abdeckung: number | null }>();
  if (!figuren.length) return aus;
  const zeilen = await db.all<{ fig_number: string; condition: string; avg_price: string; abdeckung: string | null }>(
    `SELECT fig_number, condition, avg_price, abdeckung FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2 AND geschaetzt AND avg_price > 0
        AND fetched_at > NOW() - make_interval(hours => $3)`, [[...new Set(figuren)], waehrung, ttlStunden]);
  for (const z of zeilen) aus.set(`${z.fig_number}|${z.condition}`, { preis: Number(z.avg_price), abdeckung: z.abdeckung == null ? null : Number(z.abdeckung) });
  return aus;
}

export function geschaetzterFigurenpreis(db: DbSchnittstelle, figNumber: string, zustand: string, waehrung: string, ttlStunden: number) {
  return db.get<{ avg_price: string | null; abdeckung: string | null }>(
    `SELECT avg_price, abdeckung FROM minifig_price_cache
        WHERE fig_number = $1 AND condition = $2 AND currency_code = $3 AND geschaetzt
          AND fetched_at > NOW() - make_interval(hours => $4)`, [figNumber, zustand, waehrung, ttlStunden]);
}

export function merkeGeschaetztenFigurenpreis(db: DbSchnittstelle, figNumber: string, zustand: string, waehrung: string, preis: number, abdeckung: number) {
  return db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, abdeckung)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=$4, qty_avg_price=$4, fetched_at=NOW(), geschaetzt=TRUE, abdeckung=$5`,
  [figNumber, zustand, waehrung, preis, abdeckung]);
}

export function merkeGeschaetztenFigurenverlauf(db: DbSchnittstelle, figNumber: string, zustand: string, waehrung: string, preis: number, abdeckung: number) {
  return db.run(`INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, abdeckung)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT DO NOTHING`, [figNumber, zustand, waehrung, preis, abdeckung]);
}
