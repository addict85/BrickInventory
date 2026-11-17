import type { DbSchnittstelle } from '../../../db/database';

/** In einem Schritt, damit zwei Prozesse nie denselben Platz bekommen. */
export function belegeTakt(db: DbSchnittstelle, api: string, abstandMs: number) {
  return db.get<{ warte_ms: number | string }>(
    `INSERT INTO api_cadence (api, next_at) VALUES ($1, clock_timestamp() + make_interval(secs => $2 / 1000.0))
       ON CONFLICT (api) DO UPDATE
         SET next_at = GREATEST(api_cadence.next_at, clock_timestamp()) + make_interval(secs => $2 / 1000.0)
       RETURNING GREATEST(0, EXTRACT(EPOCH FROM (next_at - clock_timestamp())) * 1000 - $2) AS warte_ms`,
    [api, abstandMs],
  );
}

export function schiebeTakt(db: DbSchnittstelle, api: string, waitMs: number) {
  return db.run(
    `UPDATE api_cadence SET next_at = GREATEST(next_at, clock_timestamp() + make_interval(secs => $2 / 1000.0))
           WHERE api = $1`,
    [api, waitMs],
  );
}
