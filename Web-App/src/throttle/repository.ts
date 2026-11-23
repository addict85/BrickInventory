import type { DbInterface } from '../../db/database';

/** `ongoing` counts checks currently in flight, so concurrent attempts can't jointly
 * jump the limit. */

export type CounterRow = { count: string; wait_min: string; since: string };

export function read(db: DbInterface, key: string, windowMin: number) {
  return db.get<CounterRow>(
    `SELECT count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS since
       FROM rate_limit_attempts
      WHERE key = $1 AND first_at > NOW() - make_interval(mins => $2)`,
    [key, windowMin],
  );
}

export async function increase(db: DbInterface, key: string, windowMin: number): Promise<number> {
  return Number(
    (
      await db.get<{ count: string }>(
        `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_at  = NOW(),
       count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN NOW() ELSE rate_limit_attempts.first_at END,
       ongoing  = GREATEST(rate_limit_attempts.ongoing - 1, 0)
     RETURNING count`,
        [key, windowMin],
      )
    )?.count ?? 0,
  );
}

export type LockState = {
  count: string;
  ongoing: string;
  expired: boolean;
  running_stale: boolean;
  wait_min: string;
  since: string;
};

export async function lock(tx: DbInterface, key: string, windowMin: number, ongoingDecayS: number): Promise<LockState> {
  await tx.run(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at, ongoing)
                VALUES ($1, 0, NOW(), NULL, 0) ON CONFLICT (key) DO NOTHING`,
    [key],
  );
  return (await tx.get<LockState>(
    `SELECT count, ongoing,
            first_at < NOW() - make_interval(mins => $2) AS expired,
            COALESCE(ongoing_since < NOW() - make_interval(secs => $3), TRUE) AS running_stale,
            EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS since
       FROM rate_limit_attempts WHERE key = $1 FOR UPDATE`,
    [key, windowMin, ongoingDecayS],
  ))!;
}

export async function occupySlot(tx: DbInterface, key: string, ongoing: number, fresh: boolean): Promise<void> {
  await tx.run(
    `UPDATE rate_limit_attempts
        SET ongoing = $2, ongoing_since = NOW(),
            count = CASE WHEN $3 THEN 0 ELSE count END,
            first_at = CASE WHEN $3 THEN NOW() ELSE first_at END
      WHERE key = $1`,
    [key, ongoing, fresh],
  );
}

export async function freeSlot(db: DbInterface, key: string): Promise<void> {
  await db.run('UPDATE rate_limit_attempts SET ongoing = GREATEST(ongoing - 1, 0) WHERE key = $1', [key]);
}

export async function deleteCounter(db: DbInterface, key: string): Promise<void> {
  await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [key]);
}

export async function deleteCountersWithPrefix(db: DbInterface, prefix: string): Promise<void> {
  await db.run('DELETE FROM rate_limit_attempts WHERE left(key, length($1)) = $1', [prefix]);
}

export async function deleteOldCounters(db: DbInterface, knownMin: number): Promise<number> {
  return (
    (
      await db.run(
        `
    DELETE FROM rate_limit_attempts
     WHERE COALESCE(last_at, first_at) < NOW() - CASE WHEN key LIKE 'login-bekannt|%'
                                                     THEN make_interval(mins => $1) ELSE interval '1 day' END`,
        [knownMin],
      )
    ).changes || 0
  );
}

export async function countUp(
  db: DbInterface,
  key: string,
  windowMin: number,
): Promise<{ count: string; wait_min: string }> {
  return (await db.get<{ count: string; wait_min: string }>(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_at  = NOW(),
       count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN NOW() ELSE rate_limit_attempts.first_at END
     RETURNING count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min`,
    [key, windowMin],
  ))!;
}

/** Per account and hour (balance lookups): the limit only falls after a full hour. */
export function hourlyState(tx: DbInterface, key: string) {
  return tx.get<{ count: number; wait_sec: number }>(
    `SELECT count AS count,
       CEIL(EXTRACT(EPOCH FROM (first_at + INTERVAL '1 hour' - NOW())))::int AS wait_sec
     FROM rate_limit_attempts WHERE key = $1 AND first_at > NOW() - INTERVAL '1 hour'`,
    [key],
  );
}

export async function countHour(tx: DbInterface, key: string): Promise<void> {
  await tx.run(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET last_at = NOW(),
       count = CASE WHEN rate_limit_attempts.first_at <= NOW() - INTERVAL '1 hour' THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at <= NOW() - INTERVAL '1 hour' THEN NOW() ELSE rate_limit_attempts.first_at END`,
    [key],
  );
}

/** Count and return state in one step: one row, if the day was free. */
export function countOncePerDay(db: DbInterface, key: string) {
  return db.get<{ key: string }>(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET count = 1, first_at = NOW(), last_at = NOW()
       WHERE rate_limit_attempts.first_at < NOW() - INTERVAL '1 day'
     RETURNING key`,
    [key],
  );
}

export interface BudgetClaim {
  cost: number;
  job: boolean;
  windowS: number;
  budget: number;
  jobBudget: number;
  /** The services' clock (ms), not the database's: tests move it. */
  nowMs: number;
}
export type BudgetRow = { units: number; jobs: number; allowed: boolean; rest_s: string };

/** One statement under the row lock of the upsert: concurrent requests of every web process see
 * one another. An expired window starts anew; a rejected claim adds nothing. */
export async function claimApiBudget(db: DbInterface, uid: number, c: BudgetClaim): Promise<BudgetRow> {
  return (await db.get<BudgetRow>(
    `INSERT INTO api_budget AS b (user_id, window_start, units, jobs, last_allowed)
     SELECT $1, to_timestamp($7 / 1000.0), CASE WHEN v.ok THEN $2 ELSE 0 END, CASE WHEN v.ok AND $3 THEN 1 ELSE 0 END, v.ok
       FROM (SELECT $2::int <= $5::int AND (NOT $3::boolean OR 0 < $6::int) AS ok) v
     ON CONFLICT (user_id) DO UPDATE SET (window_start, units, jobs, last_allowed) = (
       SELECT y.start, y.units + CASE WHEN y.ok THEN $2 ELSE 0 END, y.jobs + CASE WHEN y.ok AND $3 THEN 1 ELSE 0 END, y.ok
         FROM (SELECT x.start, x.units, x.jobs, x.units + $2 <= $5 AND (NOT $3 OR x.jobs < $6) AS ok
                 FROM (SELECT CASE WHEN w.fresh THEN to_timestamp($7 / 1000.0) ELSE b.window_start END AS start,
                              CASE WHEN w.fresh THEN 0 ELSE b.units END AS units,
                              CASE WHEN w.fresh THEN 0 ELSE b.jobs END AS jobs
                         FROM (SELECT b.window_start <= to_timestamp($7 / 1000.0) - make_interval(secs => $4) AS fresh) w) x) y)
     RETURNING units, jobs, last_allowed AS allowed,
               CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => $4) - to_timestamp($7 / 1000.0)))) AS rest_s`,
    [uid, c.cost, c.job, c.windowS, c.budget, c.jobBudget, c.nowMs],
  ))!;
}

/** Only for tests: a budget that does not depend on the previous case. */
export async function clearApiBudget(db: DbInterface, uid: number): Promise<void> {
  await db.run('DELETE FROM api_budget WHERE user_id = $1', [uid]);
}
