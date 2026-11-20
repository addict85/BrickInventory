import type { DbInterface } from '../../../db/database';
import type { FinancesReadContract } from '../readContract';
import { marktpreisSql } from '../../../db/geldSql';
import type { Spalten, Tabellen } from '../../../db/zeilen';

/** Ein Alarm, wie Übersicht und Detail ihn lesen; `besitzt` aus BESITZT. */
export type AlarmRow = Spalten<
  'price_alerts',
  | 'set_number'
  | 'condition'
  | 'direction'
  | 'threshold'
  | 'currency_code'
  | 'triggered'
  | 'last_triggered_at'
  | 'last_price'
> & { besitzt: boolean };

/** Die App macht daran die Zeile anklickbar; $3 ist das Blickfeld. */
/** Hat das Ziel schon einen Alarm (etwa an einem besessenen Set), gilt seiner;
 * sonst bräche der Primärschlüssel das Umhängen samt Merkposten ab. */
export async function transferAlarm(db: DbInterface, zuId: number, ofId: number, sn: string, c: string) {
  await db.run(
    `UPDATE price_alerts SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4
                   AND NOT EXISTS (SELECT 1 FROM price_alerts z WHERE z.user_id=$1 AND z.set_number=$3 AND z.condition=$4)`,
    [zuId, ofId, sn, c],
  );
  return db.run('DELETE FROM price_alerts WHERE user_id=$1 AND set_number=$2 AND condition=$3', [ofId, sn, c]);
}

const besitzt = (l: FinancesReadContract) =>
  `EXISTS (SELECT 1 FROM ${l.setBestand('= ANY($3)')} s WHERE s.set_number = a.set_number) AS besitzt`;

export function writeAlarm(
  db: DbInterface,
  userId: number,
  setNumber: string,
  condition: string,
  direction: 'unter' | 'ueber',
  threshold: number,
  waehrung: string,
) {
  return db.run(
    `INSERT INTO price_alerts (user_id, set_number, condition, direction, threshold, currency_code)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET direction = $4, threshold = $5, currency_code = $6,
            triggered = FALSE`,
    [userId, setNumber, condition, direction, threshold, waehrung],
  );
}

export function removeAlarm(db: DbInterface, userId: number, setNumber: string, c: string) {
  return db.run('DELETE FROM price_alerts WHERE user_id=$1 AND set_number=$2 AND condition=$3', [userId, setNumber, c]);
}

export function alertsOfSets(
  db: DbInterface,
  l: FinancesReadContract,
  userId: number,
  setNumber: string,
  blickfeld: number[],
) {
  return db.all<AlarmRow>(
    `SELECT set_number, condition, direction, threshold, currency_code,
            triggered, last_triggered_at, last_price, ${besitzt(l)}
       FROM price_alerts a WHERE user_id=$1 AND set_number=$2 ORDER BY condition`,
    [userId, setNumber, blickfeld],
  );
}

export function alertsInScope(db: DbInterface, l: FinancesReadContract, userId: number, blickfeld: number[]) {
  return db.all<
    AlarmRow & Spalten<'rb_sets', 'name' | 'set_img_url'> & Spalten<'set_catalog', 'image_local' | 'image_url'>
  >(
    `SELECT DISTINCT ON (a.set_number, a.condition)
            a.set_number, a.condition, a.direction, a.threshold, a.currency_code,
            a.triggered, a.last_triggered_at, a.last_price,
            rb.name, rb.set_img_url, c.image_local, c.image_url,
            (s.id IS NOT NULL) AS besitzt
       FROM price_alerts a
       LEFT JOIN rb_sets rb ON rb.set_num = a.set_number
       -- sets sagt, ob der Haushalt das Set BESITZT (daran haengt die Spalte
       -- besitzt und der Detaildialog), set_catalog liefert das Bild.
       LEFT JOIN ${l.setBestand('= ANY($2)')} s ON s.set_number = a.set_number
       LEFT JOIN set_catalog c ON c.set_number = a.set_number
      WHERE a.user_id = $1
      ORDER BY a.set_number, a.condition, c.image_local NULLS LAST, s.id`,
    [userId, blickfeld],
  );
}

export function databaseNow(db: DbInterface) {
  return db.get<{ jetzt: Date }>('SELECT NOW() AS jetzt');
}

export function alertsOfAccount(
  db: DbInterface,
  l: FinancesReadContract,
  userId: number,
  marke: Date,
  blickfeld: number[],
) {
  return db.all<AlarmRow>(
    `SELECT set_number, condition, direction, threshold, currency_code,
            triggered, last_triggered_at, last_price, ${besitzt(l)}
       FROM price_alerts a
      WHERE user_id = $1 AND triggered = TRUE
        -- Auch die SPALTE auf Millisekunden: Zeilen, die vor dieser Aenderung
        -- geschrieben wurden, tragen noch Mikrosekunden.
        AND last_triggered_at IS NOT NULL AND date_trunc('milliseconds', last_triggered_at) > $2
      ORDER BY last_triggered_at`,
    [userId, marke, blickfeld],
  );
}

export function allActiveAlerts(db: DbInterface, setNumber: string) {
  return db.all<
    Spalten<
      'price_alerts',
      'user_id' | 'set_number' | 'condition' | 'direction' | 'threshold' | 'currency_code' | 'triggered'
    > &
      Spalten<'users', 'email' | 'username'> & { sprache: NonNullable<Tabellen['user_settings']['value']> }
  >(
    `SELECT a.user_id, a.set_number, a.condition, a.direction, a.threshold,
            a.currency_code, a.triggered, u.email, u.username,
            COALESCE(us.value, 'de') AS sprache
       FROM price_alerts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_settings us ON us.user_id = a.user_id AND us.key = 'language'
      WHERE a.set_number = $1`,
    [setNumber],
  );
}

export function cachePriceForAlarm(db: DbInterface, set_number: string, condition: string, currency_code: string) {
  return db.get<{ marktpreis: number | null }>(
    `SELECT ${marktpreisSql()} AS marktpreis FROM price_cache
        WHERE set_number=$1 AND condition=$2 AND currency_code=$3`,
    [set_number, condition, currency_code],
  );
}

export function setAlarmBack(db: DbInterface, user_id: number, set_number: string, condition: string) {
  return db.run(
    `UPDATE price_alerts SET triggered = FALSE
                       WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
    [user_id, set_number, condition],
  );
}

export function resolveAlarmFrom(
  db: DbInterface,
  user_id: number,
  set_number: string,
  condition: string,
  preis: number,
) {
  return db.run(
    `UPDATE price_alerts SET triggered = TRUE, last_triggered_at = NOW(), last_price = $4
        WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
    [user_id, set_number, condition, preis],
  );
}

export function setNameFromMaster(db: DbInterface, set_number: string) {
  return db.get<{ name: string | null }>('SELECT name FROM rb_sets WHERE set_num = $1', [set_number]);
}

export function alertsForExport(db: DbInterface, uid: number) {
  return db.all<{
    set_number: string;
    condition: string;
    direction: string;
    threshold: number | string;
    currency_code: string;
  }>(
    `SELECT set_number, condition, direction, threshold, currency_code
       FROM price_alerts
      WHERE user_id = $1
      ORDER BY set_number, condition`,
    [uid],
  );
}
