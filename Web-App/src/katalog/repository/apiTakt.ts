import * as db from '../../../db/database';

/** In einem Schritt, damit zwei Prozesse nie denselben Platz bekommen. */
export function belegeTakt(api: string, abstandMs: number) {
  return db.get<{ warte_ms: number | string }>(`INSERT INTO api_takt (api, naechster) VALUES ($1, clock_timestamp() + make_interval(secs => $2 / 1000.0))
       ON CONFLICT (api) DO UPDATE
         SET naechster = GREATEST(api_takt.naechster, clock_timestamp()) + make_interval(secs => $2 / 1000.0)
       RETURNING GREATEST(0, EXTRACT(EPOCH FROM (naechster - clock_timestamp())) * 1000 - $2) AS warte_ms`, [api, abstandMs]);
}

export function schiebeTakt(api: string, waitMs: number) {
  return db.run(`UPDATE api_takt SET naechster = GREATEST(naechster, clock_timestamp() + make_interval(secs => $2 / 1000.0))
           WHERE api = $1`, [api, waitMs]);
}
