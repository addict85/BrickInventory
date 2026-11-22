import type { DbInterface, Hit } from '../../../db/database';
import type { JobsReadContract } from '../readContract';
import { randomUUID } from 'node:crypto';
import { LOCKS } from '../../infra/lockNamespaces';
import { attemptsKeyLock, giveKeyLockFree } from '../../../db/txLock';
import type { JobKind, Enqueue, JobRow, Claim, Progress, Pause, JobStatus } from '../jobs';
import type { Columns } from '../../../db/rows';

/** Only the SQL here; waking, waiting times and working on behalf of an account
 * live in the service. */
type Stand = { s: string } | undefined;

export interface JobListenRow {
  id: string;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  due_at: Date | null;
  deadline_at: Date | null;
  started_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  progress: Progress | null;
  error_message: string | null;
  user_id: number | null;
  geplant: boolean;
  waiting: boolean;
  set_number: string | null;
}
/** @returns the identifier, or null if the same job is already open */
export async function addJobOne(
  db: DbInterface,
  art: JobKind,
  payload: object,
  o: Enqueue = {},
): Promise<string | null> {
  const z = await db.get<{ id: string }>(
    `INSERT INTO jobs (type, payload, user_id, dedupe_key, max_attempts, due_at, progress)
     VALUES ($1, $2, $3, $4, $5, COALESCE($7::timestamptz, NOW() + make_interval(secs => $6)), $8)
     ON CONFLICT (dedupe_key) WHERE status = 'offen' DO NOTHING
     RETURNING id`,
    [
      art,
      JSON.stringify(payload),
      o.userId ?? null,
      o.schluessel ?? null,
      o.maxAttempts ?? 5,
      o.afterSeconds ?? 0,
      o.dueAb ?? null,
      o.fortschritt ? JSON.stringify(o.fortschritt) : null,
    ],
  );
  return z ? String(z.id) : null;
}

/** The same write path bound without a system frame (src/jobQueue/context.ts). */
export const addOwnJobOne = addJobOne;

/** Per key one open job that adds the list's new entries to its own:
 * a new list is not a new job. If one is running, at most one open job arises
 * next to it (unique only under 'offen'); duplicate entries exist only once. */
export async function enqueueList(
  db: DbInterface,
  art: string,
  payload: object,
  o: { schluessel: string; liste: string; hoechstens: number; userId: number },
): Promise<string> {
  const z = await db.get<{ id: string }>(
    `INSERT INTO jobs (type, payload, user_id, dedupe_key) VALUES ($5, $2, $3, $1)
     ON CONFLICT (dedupe_key) WHERE status = 'offen' DO UPDATE SET updated_at = NOW(),
       payload = jsonb_set(jobs.payload, ARRAY[$6::text], (
         SELECT COALESCE(jsonb_agg(p ORDER BY n), '[]'::jsonb) FROM (
           SELECT p, MIN(n) AS n FROM (
             SELECT p, n FROM jsonb_array_elements(jobs.payload->$6) WITH ORDINALITY AS alt(p, n)
             UNION ALL
             SELECT p, n + 1000000 FROM jsonb_array_elements(EXCLUDED.payload->$6) WITH ORDINALITY AS neu(p, n)
           ) beide GROUP BY p ORDER BY MIN(n) LIMIT $4) vereint))
     RETURNING id`,
    [o.schluessel, JSON.stringify(payload), o.userId, o.hoechstens, art, o.liste],
  );
  return String(z!.id);
}

/** Back to 'offen', unless a newer open job with the same key
 * already exists: then that one takes over, and this one ends as 'abgebrochen' — two
 * open ones with one key are forbidden by the index, the UPDATE would otherwise fail. */
const OPEN_OR_REPLACED = `CASE WHEN EXISTS (SELECT 1 FROM jobs z WHERE z.dedupe_key = jobs.dedupe_key
                                   AND z.status = 'offen' AND z.id <> jobs.id)
            THEN 'abgebrochen' ELSE 'offen' END`;

/** If the twin arises between check and write, the second attempt sees it. */
async function againAtTwin<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === '23505') return f();
    throw e;
  }
}
/** A 'laeuft' with an expired deadline belongs to a vanished process and
 * is reassigned. SKIP LOCKED: two workers never grab the same row; two
 * exclusive ones of the same kind are prevented by the trigger from migration 0099.
 * @param except identifiers this process is still executing: never reassign to itself */
export async function claimJob(
  db: DbInterface,
  kinds: readonly string[],
  deadlineSec: number,
  occupiedOf: string = randomUUID(),
  exclusive: readonly string[] = [],
  except: readonly string[] = [],
): Promise<JobRow | null> {
  const z = await db.get<RawRow>(
    `UPDATE jobs SET status = 'laeuft', attempts = attempts + 1, locked_by = $1, waiting = false,
            deadline_at = NOW() + make_interval(secs => $2), started_at = NOW(), updated_at = NOW()
      WHERE id = (SELECT a.id FROM jobs a
                   WHERE a.type = ANY($3)
                     AND a.id::text <> ALL($5::text[])
                     AND ((a.status = 'offen' AND a.due_at <= NOW())
                       OR (a.status = 'laeuft' AND a.deadline_at < NOW()))
                     AND NOT EXISTS (SELECT 1 FROM job_pauses p WHERE p.type = a.type AND p.until_at > NOW())
                     AND NOT ((a.type = ANY($4) OR EXISTS (SELECT 1 FROM job_exclusive_locks e WHERE e.type = a.type))
                          AND EXISTS (SELECT 1 FROM jobs l WHERE l.type = a.type AND l.status = 'laeuft'
                                         AND l.deadline_at >= NOW() AND l.id <> a.id))
                   ORDER BY a.due_at, a.id LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING ${COLUMNS}`,
    [occupiedOf, deadlineSec, [...kinds], [...exclusive], [...except]],
  );
  return z ? asRow(z) : null;
}
/** Taking it out is a migration: a worker without the kind is otherwise a test or an old version. */
export async function rememberExclusive(db: DbInterface, exclusive: readonly string[]): Promise<void> {
  if (exclusive.length)
    await db.run('INSERT INTO job_exclusive_locks (type) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [
      [...exclusive],
    ]);
}
/** @returns false if the job no longer belongs to this run (also: aborted) */
export async function heartbeat(db: DbInterface, a: Claim, deadlineSec: number): Promise<boolean> {
  const r = await db.run(
    `UPDATE jobs SET deadline_at = NOW() + make_interval(secs => $3), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'laeuft'`,
    [a.id, a.locked_by, deadlineSec],
  );
  return (r?.changes ?? 0) > 0;
}
/** Read only: a status change wakes every run; none of them should write while doing so. */
export async function belongsStill(db: DbInterface, a: Claim): Promise<boolean> {
  return !!(await db.get<{ ja: number }>(
    `SELECT 1 AS ja FROM jobs WHERE id = $1 AND locked_by = $2 AND status = 'laeuft'`,
    [a.id, a.locked_by],
  ));
}
export function writeProgress(db: DbInterface, a: Claim, f: Progress, deadlineSec: number): Promise<Stand> {
  return db.get<{ s: string }>(
    `UPDATE jobs SET progress = $3, deadline_at = NOW() + make_interval(secs => $4), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
    [a.id, a.locked_by, JSON.stringify(f), deadlineSec],
  );
}
/** PDF and CSV carry whole lists; once done, nobody needs them any more. */
export function setDone(db: DbInterface, a: Claim, discardPayload: boolean): Promise<Stand> {
  return db.get<{ s: string }>(
    `UPDATE jobs SET status = 'erledigt', locked_by = NULL, error_message = NULL, deadline_at = NULL, updated_at = NOW(),
            payload = CASE WHEN $3 THEN '{}'::jsonb ELSE payload END
      WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
    [a.id, a.locked_by, discardPayload],
  );
}
export function setFailed(
  db: DbInterface,
  a: Claim,
  final: boolean,
  error: string,
  waitTimeSec: number,
): Promise<Stand> {
  return againAtTwin(() =>
    db.get<{ s: string }>(
      `UPDATE jobs SET status = CASE WHEN $3 THEN 'fehler' ELSE ${OPEN_OR_REPLACED} END,
              error_message = $4, locked_by = NULL, deadline_at = NULL, updated_at = NOW(),
              due_at = NOW() + make_interval(secs => $5)
        WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
      [a.id, a.locked_by, final, error.slice(0, 2000), waitTimeSec],
    ),
  );
}
/** If the attempt does not count, the number of attempts stays as it was before claiming.
 * `waiting`: the job has not failed; admin shows it as waiting. */
export function setMoved(
  db: DbInterface,
  a: Claim,
  final: boolean,
  bis: Date,
  grund: string,
  counts: boolean,
): Promise<Stand> {
  return againAtTwin(() =>
    db.get<{ s: string }>(
      `UPDATE jobs SET status = CASE WHEN $3 THEN 'fehler' ELSE ${OPEN_OR_REPLACED} END,
              waiting = NOT $3, error_message = $4, due_at = $5, locked_by = NULL, deadline_at = NULL,
              attempts = CASE WHEN $6 THEN attempts ELSE GREATEST(attempts - 1, 0) END, updated_at = NOW()
        WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
      [a.id, a.locked_by, final, grund.slice(0, 2000), bis, counts],
    ),
  );
}
type Querier = Pick<import('pg').ClientBase, 'query'>;

export async function holdProcessLock(c: Querier, process: string): Promise<void> {
  await c.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCKS.JOB_PROCESS, process]);
}

/** Claims of other processes whose lock is free: the process no longer lives
 * (the lock ends with its connection). The attempt counts as after a deadline.
 * @returns returned jobs */
export async function giveOrphanedBack(c: Querier, process: string): Promise<number> {
  const { rows } = await c.query<{ p: string }>(
    `SELECT DISTINCT split_part(locked_by, '/', 1) AS p FROM jobs
      WHERE status = 'laeuft' AND locked_by LIKE '%/%' AND split_part(locked_by, '/', 1) <> $1`,
    [process],
  );
  let n = 0;
  for (const { p } of rows) {
    if (!(await attemptsKeyLock(c, LOCKS.JOB_PROCESS, p))) continue;
    try {
      const back = () =>
        c.query(
          `UPDATE jobs SET status = ${OPEN_OR_REPLACED}, locked_by = NULL, deadline_at = NULL,
                  due_at = NOW(), updated_at = NOW()
            WHERE status = 'laeuft' AND split_part(locked_by, '/', 1) = $1 AND locked_by LIKE '%/%'`,
          [p],
        );
      n += (await againAtTwin(back)).rowCount ?? 0;
    } finally {
      await giveKeyLockFree(c, LOCKS.JOB_PROCESS, p);
    }
  }
  return n;
}

/** The attempt does not count. */
export async function giveBack(db: DbInterface, a: Claim): Promise<void> {
  await againAtTwin(() =>
    db.run(
      `UPDATE jobs SET status = ${OPEN_OR_REPLACED}, attempts = GREATEST(attempts - 1, 0), locked_by = NULL,
              deadline_at = NULL, due_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND locked_by = $2 AND status = 'laeuft'`,
      [a.id, a.locked_by],
    ),
  );
}
export async function cleanCompletedOn(db: DbInterface): Promise<number> {
  const r = await db.run(
    `DELETE FROM jobs
      WHERE (status IN ('erledigt', 'abgebrochen') AND updated_at < NOW() - INTERVAL '7 days')
         OR (status = 'fehler' AND updated_at < NOW() - INTERVAL '30 days')`,
  );
  return r?.changes ?? 0;
}
export async function liesPause(db: DbInterface, art: JobKind): Promise<Pause | null> {
  return (
    (await db.get<Columns<'job_pauses', 'type' | 'until_at' | 'reason' | 'level'>>(
      'SELECT type, until_at, reason, level FROM job_pauses WHERE type = $1',
      [art],
    )) ?? null
  );
}
/** `level` counts repeated throttling (Cloudflare). */
export async function pauseKind(
  db: DbInterface,
  art: JobKind,
  bis: Date,
  grund: string,
  level?: number,
): Promise<void> {
  await db.run(
    `INSERT INTO job_pauses (type, until_at, reason, level) VALUES ($1, $2, $3, COALESCE($4, 0))
     ON CONFLICT (type) DO UPDATE SET until_at = EXCLUDED.until_at, reason = EXCLUDED.reason,
       level = COALESCE($4, job_pauses.level)`,
    [art, bis, grund, level ?? null],
  );
}
export async function deletePause(db: DbInterface, art: JobKind): Promise<void> {
  await db.run('DELETE FROM job_pauses WHERE type = $1', [art]);
}
/** A running one stops at its next sign of life. */
export async function setAborted(db: DbInterface, id: string): Promise<JobRow | null> {
  const z = await db.get<RawRow>(
    `UPDATE jobs SET status = 'abgebrochen', deadline_at = NULL, updated_at = NOW(), waiting = false,
            error_message = COALESCE(error_message, 'abgebrochen')
      WHERE id = $1 AND status IN ('offen', 'laeuft') RETURNING ${COLUMNS}`,
    [id],
  );
  return z ? asRow(z) : null;
}
export async function placeAgainOne(db: DbInterface, id: string): Promise<boolean> {
  const r = await db.run(
    `UPDATE jobs a SET status = 'offen', attempts = 0, error_message = NULL, due_at = NOW(), locked_by = NULL, waiting = false,
            updated_at = NOW()
      WHERE a.id = $1 AND a.status IN ('fehler', 'abgebrochen')
        AND NOT EXISTS (SELECT 1 FROM jobs o WHERE o.dedupe_key = a.dedupe_key AND o.status = 'offen')`,
    [id],
  );
  return (r?.changes ?? 0) > 0;
}
/** A scheduled appointment stays. */
export async function emptyKind(db: DbInterface, art: JobKind): Promise<number> {
  const r = await db.run(
    `DELETE FROM jobs WHERE type = $1 AND status = 'offen' AND (dedupe_key IS NULL OR dedupe_key NOT LIKE 'plan:%')`,
    [art],
  );
  return r?.changes ?? 0;
}
export async function makeDue(db: DbInterface, art: JobKind, key?: string): Promise<number> {
  const r = await db.run(
    `UPDATE jobs SET due_at = NOW(), updated_at = NOW()
      WHERE type = $1 AND status = 'offen' AND ($2::text IS NULL OR dedupe_key = $2)`,
    [art, key ?? null],
  );
  return r?.changes ?? 0;
}
export function statusNumbers(db: DbInterface, art: JobKind) {
  return db.all<{ status: JobStatus; n: number }>(
    'SELECT status, COUNT(*)::int AS n FROM jobs WHERE type = $1 GROUP BY status',
    [art],
  );
}
/** The role as it is now, not as at queuing time. */
export function accountRole(db: DbInterface, l: JobsReadContract, uid: number) {
  return db.get<{ is_admin: boolean }>(`SELECT is_admin FROM ${l.KONTEN} k WHERE id = $1`, [uid]);
}
export const JOB_CHANNEL = 'auftraege';
export const JOB_STATUS_CHANNEL = 'auftrag_stand';
export const COLUMNS =
  'id, type, payload, user_id, dedupe_key, status, attempts, max_attempts, locked_by, error_message';
/** The identifier does not always come from the database as text; to the outside it is. */
type RawRow = Omit<JobRow, 'id'> & { id: unknown };
export const asRow = (z: RawRow): JobRow => ({ ...z, id: String(z.id) });

export async function setDueDate(db: DbInterface, key: string, dueFrom: Date): Promise<void> {
  await db.run(`UPDATE jobs SET due_at = $2, updated_at = NOW() WHERE dedupe_key = $1 AND status = 'offen'`, [
    key,
    dueFrom,
  ]);
}

export async function pullAppointmentBefore(
  db: DbInterface,
  key: string,
  seconds: number,
  payload: object,
): Promise<boolean> {
  const r = await db.run(
    `UPDATE jobs SET due_at = LEAST(due_at, NOW() + make_interval(secs => $2)),
            payload = payload || $3::jsonb, updated_at = NOW()
      WHERE dedupe_key = $1 AND status = 'offen'`,
    [key, seconds, JSON.stringify(payload)],
  );
  return (r.changes ?? 0) > 0;
}

export async function runningKind(db: DbInterface, art: string): Promise<boolean> {
  return !!(await db.get<Hit>(`SELECT 1 FROM jobs WHERE type = $1 AND status = 'laeuft'`, [art]));
}

/** The highest counter `feld` of the payload among the waiting jobs of this key. */
export async function highestCounter(db: DbInterface, key: string, field: string): Promise<number> {
  const z = await db.get<{ v: number }>(
    `SELECT COALESCE(MAX((payload->>$2)::int), 0) AS v FROM jobs
      WHERE dedupe_key = $1 AND status IN ('offen', 'laeuft')`,
    [key, field],
  );
  return z?.v ?? 0;
}

/** An already open job with the same key is rescheduled, not duplicated. */
export async function writeResubmission(
  db: DbInterface,
  art: string,
  key: string,
  payload: object,
  o: { dueAb: Date; fehler: string; maxAttempts: number },
): Promise<void> {
  await db.run(
    `INSERT INTO jobs (type, payload, dedupe_key, max_attempts, due_at, error_message)
     VALUES ($5, $2, $1, $6, $3, $4)
     ON CONFLICT (dedupe_key) WHERE status = 'offen'
       DO UPDATE SET payload = EXCLUDED.payload, due_at = EXCLUDED.due_at,
                     error_message = EXCLUDED.error_message, updated_at = NOW()`,
    [key, JSON.stringify(payload), o.dueAb, o.fehler, art, o.maxAttempts],
  );
}

export async function openDelete(db: DbInterface, key: string): Promise<void> {
  await db.run(`DELETE FROM jobs WHERE dedupe_key = $1 AND status = 'offen'`, [key]);
}

export interface WaitingRow {
  payload: Record<string, unknown>;
  due_at: Date;
  error_message: string | null;
  created_at: Date | null;
}

/** Waiting and running jobs of a kind, by due time. */
export function waitingTheKind(db: DbInterface, art: string) {
  return db.all<WaitingRow>(
    `SELECT payload, due_at, error_message, created_at FROM jobs
      WHERE type = $1 AND status IN ('offen', 'laeuft') ORDER BY due_at, id`,
    [art],
  );
}

export function numbersTheKind(db: DbInterface, art: string) {
  return db.get<{ wartend: number; faellig: number }>(
    `SELECT COUNT(*)::int AS wartend, COUNT(*) FILTER (WHERE due_at <= NOW())::int AS faellig
       FROM jobs WHERE type = $1 AND status IN ('offen', 'laeuft')`,
    [art],
  );
}

/** Without payload (whole lists) and without account, because the admin sees the list. */
export function jobList(db: DbInterface, status: string[], art: string | null) {
  return db.all<JobListenRow>(
    `SELECT id::text AS id, type, status, attempts, max_attempts, due_at, deadline_at, started_at, created_at,
            updated_at, progress, error_message, COALESCE(dedupe_key LIKE 'plan:%', false) AS geplant, waiting,
            payload->>'set_number' AS set_number
       FROM jobs
      WHERE status = ANY($1) AND ($2::text IS NULL OR type = $2)
      ORDER BY CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 1 WHEN 'fehler' THEN 2 ELSE 3 END,
               due_at, id
      LIMIT 200`,
    [status, art],
  );
}

export interface LastStatus {
  type: JobKind;
  status: JobStatus;
  progress: Progress | null;
  error_message: string | null;
  updated_at: Date | null;
}
/** Per kind the running job, otherwise the most recently finished one, otherwise the next scheduled one. */
export function lastPerKind(db: DbInterface, kinds: readonly JobKind[]) {
  return db.all<LastStatus>(
    `SELECT DISTINCT ON (type) type, status, progress, error_message, updated_at FROM jobs
      WHERE type = ANY($1)
      ORDER BY type, CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 2 ELSE 1 END, updated_at DESC`,
    [[...kinds]],
  );
}

export function numbersJeKindAndStatus(db: DbInterface) {
  return db.all<{ type: string; status: string; anzahl: number }>(
    `SELECT type, status, COUNT(*)::int AS anzahl FROM jobs GROUP BY type, status ORDER BY type, status`,
  );
}

export function runningPauses(db: DbInterface) {
  return db.all<{ type: string; until_at: Date; reason: string | null }>(
    `SELECT type, until_at, reason FROM job_pauses WHERE until_at > NOW() ORDER BY until_at`,
  );
}

export function jobStatus(db: DbInterface, id: string, uid: number) {
  return db.get<{ status: JobStatus; progress: Progress | null; result: Record<string, unknown> | null }>(
    'SELECT status, progress, result FROM jobs WHERE id = $1 AND user_id = $2',
    [id, uid],
  );
}

/** Whatever was due later gets its turn by `bis`. */
export function pullAppointmentsBefore(db: DbInterface, art: string, bis: Date) {
  return db.run(`UPDATE jobs SET due_at = $1 WHERE type = $2 AND status = 'offen' AND due_at > NOW()`, [bis, art]);
}

export async function writeResult(db: DbInterface, id: string, result: Record<string, unknown> | null): Promise<void> {
  await db.run('UPDATE jobs SET result = $2 WHERE id = $1', [id, result === null ? null : JSON.stringify(result)]);
}

/** Only the own one: the key is in the address, it alone grants no right. */
export function ownRow(db: DbInterface, art: string, key: string, uid: number) {
  return db.get<{
    status: JobStatus;
    error_message: string | null;
    user_id: number | null;
    progress: Progress | null;
  }>(
    `SELECT status, error_message, user_id, progress FROM jobs
      WHERE type = $3 AND dedupe_key = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`,
    [key, uid, art],
  );
}

/** A stuck one no longer counts after `deadlineSec`. */
export function countRunningRows(db: DbInterface, art: string, uid: number, deadlineSec: number) {
  return db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM jobs
      WHERE type = $3 AND user_id = $1 AND status IN ('offen', 'laeuft')
        AND created_at > NOW() - make_interval(secs => $2)`,
    [uid, deadlineSec, art],
  );
}

export function deleteOwnRow(db: DbInterface, art: string, key: string, uid: number) {
  return db.run(`DELETE FROM jobs WHERE type = $3 AND dedupe_key = $1 AND user_id = $2 AND status <> 'laeuft'`, [
    key,
    uid,
    art,
  ]);
}

/** Finished ones after the deadline expires; returns their keys so that files go along. */
export function deleteEndedRows(db: DbInterface, art: string, deadlineSec: number) {
  return db.all<{ dedupe_key: string }>(
    `DELETE FROM jobs WHERE type = $2 AND status IN ('erledigt', 'fehler', 'abgebrochen')
        AND updated_at < NOW() - make_interval(secs => $1)
     RETURNING dedupe_key`,
    [deadlineSec, art],
  );
}
