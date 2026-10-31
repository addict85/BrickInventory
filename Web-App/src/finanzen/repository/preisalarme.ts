import * as db from '../../../db/database';

/** Preisalarme je Konto, Set und Zustand (price_alerts) samt dem Preis, an dem sie gemessen werden. */

export function schreibeAlarm(userId: number, setNumber: string, condition: string, richtung: unknown, schwelle: unknown, waehrung: unknown) {
  return db.run(`INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET richtung = $4, schwelle = $5, currency_code = $6,
            ausgeloest = FALSE`, [userId, setNumber, condition, richtung, schwelle, waehrung]);
}

export function entferneAlarm(userId: number, setNumber: string, c: unknown) {
  return db.run('DELETE FROM price_alerts WHERE user_id=$1 AND set_number=$2 AND condition=$3', [userId, setNumber, c]);
}

export function alarmeDesSets(userId: number, setNumber: string, wert3: unknown, BESITZT_SQL: string | number) {
  return db.all(`SELECT set_number, condition, richtung, schwelle, currency_code,
            ausgeloest, zuletzt_am, zuletzt_preis, ${BESITZT_SQL}
       FROM price_alerts a WHERE user_id=$1 AND set_number=$2 ORDER BY condition`, [userId, setNumber, wert3]);
}

export function alarmeImBlickfeld(userId: number, blickfeld: unknown) {
  return db.all(`SELECT DISTINCT ON (a.set_number, a.condition)
            a.set_number, a.condition, a.richtung, a.schwelle, a.currency_code,
            a.ausgeloest, a.zuletzt_am, a.zuletzt_preis,
            rb.name, rb.set_img_url, c.image_local, c.image_url,
            (s.id IS NOT NULL) AS besitzt
       FROM price_alerts a
       LEFT JOIN rb_sets rb ON rb.set_num = a.set_number
       -- sets sagt, ob der Haushalt das Set BESITZT (daran haengt die Spalte
       -- besitzt und der Detaildialog), set_catalog liefert das Bild.
       LEFT JOIN sets s ON s.user_id = ANY($2) AND s.set_number = a.set_number
       LEFT JOIN set_catalog c ON c.set_number = a.set_number
      WHERE a.user_id = $1
      ORDER BY a.set_number, a.condition, c.image_local NULLS LAST, s.id`, [userId, blickfeld]);
}

export function datenbankJetzt() {
  return db.get('SELECT NOW() AS jetzt');
}

export function alarmeDesKontos(userId: number, marke: unknown, wert3: unknown, BESITZT_SQL: string | number) {
  return db.all(`SELECT set_number, condition, richtung, schwelle, currency_code,
            ausgeloest, zuletzt_am, zuletzt_preis, ${BESITZT_SQL}
       FROM price_alerts a
      WHERE user_id = $1 AND ausgeloest = TRUE
        -- Auch die SPALTE auf Millisekunden: Zeilen, die vor dieser Aenderung
        -- geschrieben wurden, tragen noch Mikrosekunden.
        AND zuletzt_am IS NOT NULL AND date_trunc('milliseconds', zuletzt_am) > $2
      ORDER BY zuletzt_am`, [userId, marke, wert3]);
}

export function alleAktivenAlarme(setNumber: string) {
  return db.all(`SELECT a.user_id, a.set_number, a.condition, a.richtung, a.schwelle,
            a.currency_code, a.ausgeloest, u.email, u.username,
            COALESCE(us.value, 'de') AS sprache
       FROM price_alerts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_settings us ON us.user_id = a.user_id AND us.key = 'language'
      WHERE a.set_number = $1`, [setNumber]);
}

export function cachePreisFuerAlarm(set_number: string, condition: string, currency_code: unknown) {
  return db.get(`SELECT avg_price FROM price_cache
        WHERE set_number=$1 AND condition=$2 AND currency_code=$3`, [set_number, condition, currency_code]);
}

export function setzeAlarmZurueck(user_id: number, set_number: string, condition: string) {
  return db.run(`UPDATE price_alerts SET ausgeloest = FALSE
                       WHERE user_id=$1 AND set_number=$2 AND condition=$3`, [user_id, set_number, condition]);
}

export function loeseAlarmAus(user_id: number, set_number: string, condition: string, preis: unknown) {
  return db.run(`UPDATE price_alerts SET ausgeloest = TRUE, zuletzt_am = NOW(), zuletzt_preis = $4
        WHERE user_id=$1 AND set_number=$2 AND condition=$3`, [user_id, set_number, condition, preis]);
}

export function setNameAusStamm(set_number: string) {
  return db.get('SELECT name FROM set_stamm WHERE set_number = $1', [set_number]);
}

export function alarmeFuerExport(uid: number) {
  return db.all(`SELECT set_number, condition, richtung, schwelle, currency_code
       FROM price_alerts
      WHERE user_id = $1
      ORDER BY set_number, condition`, [uid]);
}
