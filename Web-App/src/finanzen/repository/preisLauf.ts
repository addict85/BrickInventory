/** Was der Preis-Lauf liest und schreibt: welche Sets je Konto, welche Zustände, der Tagesstand. */
import * as db from '../../../db/database';

export interface PreisPlatz { user_id: number; set_number: string }

/** Sets im Bestand und auf der Merkliste, je Konto. */
export async function bestandsPlaetze(): Promise<PreisPlatz[]> {
  return db.all<PreisPlatz>('SELECT DISTINCT user_id, set_number FROM sets');
}

export async function merklistenPlaetze(): Promise<PreisPlatz[]> {
  return db.all<PreisPlatz>('SELECT DISTINCT user_id, set_number FROM wanted');
}

type ZustandsZeile = { set_number: string; c: string | null };

/** Die erfassten Zustände der Sets eines Kontos. */
export async function erfassteZustaende(userId: number, setNumbers: string[]): Promise<ZustandsZeile[]> {
  return db.all<ZustandsZeile>(
    `SELECT set_number, COALESCE(condition,'N') AS c
       FROM set_acquisitions WHERE user_id=$1 AND set_number = ANY($2)
      GROUP BY set_number, COALESCE(condition,'N')`, [userId, setNumbers]);
}

/** Die gewünschten Zustände der Merkposten eines Kontos. */
export async function gewuenschteZustaende(userId: number, setNumbers: string[]): Promise<ZustandsZeile[]> {
  return db.all<ZustandsZeile>(
    `SELECT DISTINCT set_number, COALESCE(condition,'N') AS c
       FROM wanted WHERE user_id=$1 AND set_number = ANY($2)`, [userId, setNumbers]);
}

/** Den Preis-Zwischenspeicher einmal am Tag in den Verlauf übernehmen. @returns Anzahl neuer Punkte */
export async function schreibeTagesstand(): Promise<number> {
  const r = await db.run(`
    INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, recorded_at)
    SELECT set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, NOW()
    FROM price_cache
    WHERE (avg_price > 0 OR qty_avg_price > 0)
      AND NOT EXISTS (
        SELECT 1 FROM price_history ph
        WHERE ph.set_number = price_cache.set_number
          AND ph.condition = price_cache.condition
          AND ph.currency_code = price_cache.currency_code
          AND ph.recorded_at::date = CURRENT_DATE
      ) ON CONFLICT DO NOTHING`);
  return r.changes ?? 0;
}

/** Sets, für die mindestens ein Preisalarm steht. */
export async function setsMitAlarm(): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>('SELECT DISTINCT set_number FROM price_alerts');
  return rows.map(r => String(r.set_number));
}
