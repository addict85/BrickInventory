import type { DbInterface } from '../../../db/database';

/** In one step so that two processes never get the same slot. */
export function receiptsTick(db: DbInterface, api: string, gapMs: number) {
  return db.get<{ wait_ms: number | string }>(
    `INSERT INTO api_cadence (api, next_at) VALUES ($1, clock_timestamp() + make_interval(secs => $2 / 1000.0))
       ON CONFLICT (api) DO UPDATE
         SET next_at = GREATEST(api_cadence.next_at, clock_timestamp()) + make_interval(secs => $2 / 1000.0)
       RETURNING GREATEST(0, EXTRACT(EPOCH FROM (next_at - clock_timestamp())) * 1000 - $2) AS wait_ms`,
    [api, gapMs],
  );
}

export function pushTick(db: DbInterface, api: string, waitMs: number) {
  return db.run(
    `UPDATE api_cadence SET next_at = GREATEST(next_at, clock_timestamp() + make_interval(secs => $2 / 1000.0))
           WHERE api = $1`,
    [api, waitMs],
  );
}
