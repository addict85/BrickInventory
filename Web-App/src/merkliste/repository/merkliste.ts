import * as db from '../../../db/database';

/** Die Merkliste (wanted) je Konto, Set und Zustand. */

export function merkeSetVor(userId: number, sn: string, c: string, seit: Date | string | null) {
  return db.get(`INSERT INTO wanted (user_id, set_number, condition, created_at)
     VALUES ($1,$2,$3, COALESCE($4::timestamptz, NOW()))
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wanted.condition
     RETURNING (xmax = 0) AS war_neu`, [userId, sn, c, seit]);
}

export function streicheVormerkung(userId: number, setNumber: string, c: string) {
  return db.run('DELETE FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [userId, setNumber, c]);
}

export function istVorgemerkt(zuId: number, sn: string, c: string) {
  return db.get('SELECT 1 FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [zuId, sn, c]);
}

export function uebertrageVormerkung(zuId: number, vonId: number, sn: string, c: string) {
  return db.run('UPDATE wanted SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4', [zuId, vonId, sn, c]);
}

/** Der Preisalarm wandert mit der Vormerkung ins andere Konto. */
export function uebertrageAlarm(zuId: number, vonId: number, sn: string, c: string) {
  return db.run('UPDATE price_alerts SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4', [zuId, vonId, sn, c]);
}

export function merklisteImBlickfeld(werte: unknown[], pWaehrung: string, wo: string, ordnung: string) {
  return db.all(`SELECT w.set_number, w.condition, w.created_at, w.user_id,
            COALESCE(rb.name, sc.name) AS name, COALESCE(rb.year, sc.year) AS year, rb.theme_id,
            COALESCE(rb.num_parts, sc.pieces) AS num_parts,
            COALESCE(rb.set_img_url, sc.image_url) AS image_url,
            pa.richtung AS alarm_richtung, pa.schwelle AS alarm_schwelle,
            pa.ausgeloest AS alarm_ausgeloest,
            pc.avg_price AS marktpreis,
            EXISTS (SELECT 1 FROM sets s
                     WHERE s.user_id = ANY($1) AND s.set_number = w.set_number) AS owned
       FROM wanted w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
       -- Ohne Rebrickable-Katalog kennt set_catalog (wie in der Sammlung) Name und Bild.
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

export function merklisteFuerExport(uid: number) {
  return db.all(`SELECT w.set_number,
            w.condition,
            TO_CHAR(w.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS created_at
       FROM wanted w
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC, w.set_number, w.condition`, [uid]);
}
