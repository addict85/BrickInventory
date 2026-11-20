import type { DbInterface, Treffer } from '../../../db/database';
import type { JobsReadContract } from '../lesevertrag';
import { randomUUID } from 'node:crypto';
import { LOCKS } from '../../infra/lockNamespaces';
import { attemptsKeyLock, giveKeyLockFree } from '../../../db/txLock';
import type { JobKind, Einstellen, JobRow, Belegung, Fortschritt, Pause, JobStatus } from '../auftraege';
import type { Spalten } from '../../../db/zeilen';

/** Hier nur das SQL; Wecken, Wartezeiten und das Arbeiten im Namen eines Kontos
 * stehen im Dienst. */
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
  progress: Fortschritt | null;
  error_message: string | null;
  user_id: number | null;
  geplant: boolean;
  waiting: boolean;
  set_number: string | null;
}
/** @returns die Kennung, oder null, wenn derselbe Auftrag schon offen steht */
export async function addJobOne(
  db: DbInterface,
  art: JobKind,
  nutzlast: object,
  o: Einstellen = {},
): Promise<string | null> {
  const z = await db.get<{ id: string }>(
    `INSERT INTO jobs (type, payload, user_id, dedupe_key, max_attempts, due_at, progress)
     VALUES ($1, $2, $3, $4, $5, COALESCE($7::timestamptz, NOW() + make_interval(secs => $6)), $8)
     ON CONFLICT (dedupe_key) WHERE status = 'offen' DO NOTHING
     RETURNING id`,
    [
      art,
      JSON.stringify(nutzlast),
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

/** Derselbe Schreibweg ohne Systemrahmen gebunden (src/auftraege/kontext.ts). */
export const addOwnJobOne = addJobOne;

/** Je Schlüssel ein offener Auftrag, der die neuen Einträge der Liste zu seinen dazunimmt:
 * Eine neue Liste ist kein neuer Auftrag. Läuft einer, entsteht daneben höchstens ein
 * offener (eindeutig nur unter 'offen'); doppelte Einträge gibt es nur einmal. */
export async function addListAn(
  db: DbInterface,
  art: string,
  nutzlast: object,
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
    [o.schluessel, JSON.stringify(nutzlast), o.userId, o.hoechstens, art, o.liste],
  );
  return String(z!.id);
}

/** Zurück nach 'offen', ausser ein neuerer offener Auftrag mit demselben Schlüssel
 * steht schon da: Dann übernimmt der, und dieser endet als 'abgebrochen' — zwei
 * offene mit einem Schlüssel verbietet der Index, das UPDATE scheiterte sonst. */
const OFFEN_ODER_ERSETZT = `CASE WHEN EXISTS (SELECT 1 FROM jobs z WHERE z.dedupe_key = jobs.dedupe_key
                                   AND z.status = 'offen' AND z.id <> jobs.id)
            THEN 'abgebrochen' ELSE 'offen' END`;

/** Entsteht der Zwilling zwischen Prüfung und Schreiben, sieht ihn der zweite Versuch. */
async function againAtTwin<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === '23505') return f();
    throw e;
  }
}
/** Ein 'laeuft' mit abgelaufener Frist gehört einem verschwundenen Prozess und
 * wird neu vergeben. SKIP LOCKED: Zwei Worker greifen nie dieselbe Zeile; zwei
 * exklusive derselben Art verhindert der Trigger aus Migration 0099.
 * @param ausser Kennungen, die dieser Prozess noch ausführt: nie an sich selbst neu vergeben */
export async function belegeAuftrag(
  db: DbInterface,
  arten: readonly string[],
  deadlineSec: number,
  occupiedOf: string = randomUUID(),
  exklusiv: readonly string[] = [],
  ausser: readonly string[] = [],
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
      RETURNING ${SPALTEN}`,
    [occupiedOf, deadlineSec, [...arten], [...exklusiv], [...ausser]],
  );
  return z ? asRow(z) : null;
}
/** Herausnehmen ist eine Migration: Ein Worker ohne die Art ist sonst ein Test oder ein alter Stand. */
export async function rememberExclusive(db: DbInterface, exklusiv: readonly string[]): Promise<void> {
  if (exklusiv.length)
    await db.run('INSERT INTO job_exclusive_locks (type) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [
      [...exklusiv],
    ]);
}
/** @returns false, wenn der Auftrag nicht mehr diesem Lauf gehört (auch: abgebrochen) */
export async function lebenszeichen(db: DbInterface, a: Belegung, deadlineSec: number): Promise<boolean> {
  const r = await db.run(
    `UPDATE jobs SET deadline_at = NOW() + make_interval(secs => $3), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'laeuft'`,
    [a.id, a.locked_by, deadlineSec],
  );
  return (r?.changes ?? 0) > 0;
}
/** Nur lesen: Ein Statuswechsel weckt jeden Lauf, schreiben soll dabei keiner. */
export async function belongsStill(db: DbInterface, a: Belegung): Promise<boolean> {
  return !!(await db.get<{ ja: number }>(
    `SELECT 1 AS ja FROM jobs WHERE id = $1 AND locked_by = $2 AND status = 'laeuft'`,
    [a.id, a.locked_by],
  ));
}
export function writeProgress(db: DbInterface, a: Belegung, f: Fortschritt, deadlineSec: number): Promise<Stand> {
  return db.get<{ s: string }>(
    `UPDATE jobs SET progress = $3, deadline_at = NOW() + make_interval(secs => $4), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
    [a.id, a.locked_by, JSON.stringify(f), deadlineSec],
  );
}
/** PDF und CSV tragen ganze Listen; erledigt braucht die niemand mehr. */
export function setDone(db: DbInterface, a: Belegung, discardPayload: boolean): Promise<Stand> {
  return db.get<{ s: string }>(
    `UPDATE jobs SET status = 'erledigt', locked_by = NULL, error_message = NULL, deadline_at = NULL, updated_at = NOW(),
            payload = CASE WHEN $3 THEN '{}'::jsonb ELSE payload END
      WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
    [a.id, a.locked_by, discardPayload],
  );
}
export function setFailed(
  db: DbInterface,
  a: Belegung,
  final: boolean,
  fehler: string,
  waitTimeSec: number,
): Promise<Stand> {
  return againAtTwin(() =>
    db.get<{ s: string }>(
      `UPDATE jobs SET status = CASE WHEN $3 THEN 'fehler' ELSE ${OFFEN_ODER_ERSETZT} END,
              error_message = $4, locked_by = NULL, deadline_at = NULL, updated_at = NOW(),
              due_at = NOW() + make_interval(secs => $5)
        WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
      [a.id, a.locked_by, final, fehler.slice(0, 2000), waitTimeSec],
    ),
  );
}
/** Zählt der Versuch nicht, bleibt die Zahl der Versuche, wie sie vor dem Belegen war.
 * `waiting`: Der Auftrag ist nicht gescheitert, die Verwaltung zeigt ihn als wartend. */
export function setMoved(
  db: DbInterface,
  a: Belegung,
  final: boolean,
  bis: Date,
  grund: string,
  zaehlt: boolean,
): Promise<Stand> {
  return againAtTwin(() =>
    db.get<{ s: string }>(
      `UPDATE jobs SET status = CASE WHEN $3 THEN 'fehler' ELSE ${OFFEN_ODER_ERSETZT} END,
              waiting = NOT $3, error_message = $4, due_at = $5, locked_by = NULL, deadline_at = NULL,
              attempts = CASE WHEN $6 THEN attempts ELSE GREATEST(attempts - 1, 0) END, updated_at = NOW()
        WHERE id = $1 AND locked_by = $2 AND status = 'laeuft' RETURNING COALESCE(dedupe_key, id::text) AS s`,
      [a.id, a.locked_by, final, grund.slice(0, 2000), bis, zaehlt],
    ),
  );
}
type Abfrager = Pick<import('pg').ClientBase, 'query'>;

export async function holdProcessLock(c: Abfrager, prozess: string): Promise<void> {
  await c.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCKS.JOB_PROCESS, prozess]);
}

/** Belegungen anderer Prozesse, deren Sperre frei ist: Der Prozess lebt nicht mehr
 * (die Sperre endet mit seiner Verbindung). Der Versuch zählt wie nach einer Frist.
 * @returns zurückgegebene Aufträge */
export async function giveOrphanedBack(c: Abfrager, prozess: string): Promise<number> {
  const { rows } = await c.query<{ p: string }>(
    `SELECT DISTINCT split_part(locked_by, '/', 1) AS p FROM jobs
      WHERE status = 'laeuft' AND locked_by LIKE '%/%' AND split_part(locked_by, '/', 1) <> $1`,
    [prozess],
  );
  let n = 0;
  for (const { p } of rows) {
    if (!(await attemptsKeyLock(c, LOCKS.JOB_PROCESS, p))) continue;
    try {
      const zurueck = () =>
        c.query(
          `UPDATE jobs SET status = ${OFFEN_ODER_ERSETZT}, locked_by = NULL, deadline_at = NULL,
                  due_at = NOW(), updated_at = NOW()
            WHERE status = 'laeuft' AND split_part(locked_by, '/', 1) = $1 AND locked_by LIKE '%/%'`,
          [p],
        );
      n += (await againAtTwin(zurueck)).rowCount ?? 0;
    } finally {
      await giveKeyLockFree(c, LOCKS.JOB_PROCESS, p);
    }
  }
  return n;
}

/** Der Versuch zählt nicht. */
export async function giveBack(db: DbInterface, a: Belegung): Promise<void> {
  await againAtTwin(() =>
    db.run(
      `UPDATE jobs SET status = ${OFFEN_ODER_ERSETZT}, attempts = GREATEST(attempts - 1, 0), locked_by = NULL,
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
    (await db.get<Spalten<'job_pauses', 'type' | 'until_at' | 'reason' | 'level'>>(
      'SELECT type, until_at, reason, level FROM job_pauses WHERE type = $1',
      [art],
    )) ?? null
  );
}
/** `level` zählt wiederholte Drosselungen (Cloudflare). */
export async function pauseKind(
  db: DbInterface,
  art: JobKind,
  bis: Date,
  grund: string,
  stufe?: number,
): Promise<void> {
  await db.run(
    `INSERT INTO job_pauses (type, until_at, reason, level) VALUES ($1, $2, $3, COALESCE($4, 0))
     ON CONFLICT (type) DO UPDATE SET until_at = EXCLUDED.until_at, reason = EXCLUDED.reason,
       level = COALESCE($4, job_pauses.level)`,
    [art, bis, grund, stufe ?? null],
  );
}
export async function deletePause(db: DbInterface, art: JobKind): Promise<void> {
  await db.run('DELETE FROM job_pauses WHERE type = $1', [art]);
}
/** Ein laufender hört bei seinem nächsten Lebenszeichen auf. */
export async function setAborted(db: DbInterface, id: string): Promise<JobRow | null> {
  const z = await db.get<RawRow>(
    `UPDATE jobs SET status = 'abgebrochen', deadline_at = NULL, updated_at = NOW(), waiting = false,
            error_message = COALESCE(error_message, 'abgebrochen')
      WHERE id = $1 AND status IN ('offen', 'laeuft') RETURNING ${SPALTEN}`,
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
/** Ein geplanter Termin bleibt. */
export async function emptyKind(db: DbInterface, art: JobKind): Promise<number> {
  const r = await db.run(
    `DELETE FROM jobs WHERE type = $1 AND status = 'offen' AND (dedupe_key IS NULL OR dedupe_key NOT LIKE 'plan:%')`,
    [art],
  );
  return r?.changes ?? 0;
}
export async function makeDue(db: DbInterface, art: JobKind, schluessel?: string): Promise<number> {
  const r = await db.run(
    `UPDATE jobs SET due_at = NOW(), updated_at = NOW()
      WHERE type = $1 AND status = 'offen' AND ($2::text IS NULL OR dedupe_key = $2)`,
    [art, schluessel ?? null],
  );
  return r?.changes ?? 0;
}
export function statusNumbers(db: DbInterface, art: JobKind) {
  return db.all<{ status: JobStatus; n: number }>(
    'SELECT status, COUNT(*)::int AS n FROM jobs WHERE type = $1 GROUP BY status',
    [art],
  );
}
/** Die Rolle, wie sie jetzt ist, nicht wie beim Einstellen. */
export function accountRole(db: DbInterface, l: JobsReadContract, uid: number) {
  return db.get<{ is_admin: boolean }>(`SELECT is_admin FROM ${l.KONTEN} k WHERE id = $1`, [uid]);
}
export const JOB_CHANNEL = 'auftraege';
export const JOB_STATUS_CHANNEL = 'auftrag_stand';
export const SPALTEN =
  'id, type, payload, user_id, dedupe_key, status, attempts, max_attempts, locked_by, error_message';
/** Die Kennung kommt aus der Datenbank nicht immer als Text; nach aussen ist sie es. */
type RawRow = Omit<JobRow, 'id'> & { id: unknown };
export const asRow = (z: RawRow): JobRow => ({ ...z, id: String(z.id) });

export async function setDueDate(db: DbInterface, schluessel: string, dueAb: Date): Promise<void> {
  await db.run(`UPDATE jobs SET due_at = $2, updated_at = NOW() WHERE dedupe_key = $1 AND status = 'offen'`, [
    schluessel,
    dueAb,
  ]);
}

export async function pullAppointmentBefore(
  db: DbInterface,
  schluessel: string,
  seconds: number,
  nutzlast: object,
): Promise<boolean> {
  const r = await db.run(
    `UPDATE jobs SET due_at = LEAST(due_at, NOW() + make_interval(secs => $2)),
            payload = payload || $3::jsonb, updated_at = NOW()
      WHERE dedupe_key = $1 AND status = 'offen'`,
    [schluessel, seconds, JSON.stringify(nutzlast)],
  );
  return (r.changes ?? 0) > 0;
}

export async function runningKind(db: DbInterface, art: string): Promise<boolean> {
  return !!(await db.get<Treffer>(`SELECT 1 FROM jobs WHERE type = $1 AND status = 'laeuft'`, [art]));
}

/** Der höchste Zähler `feld` der Nutzlast unter den wartenden Aufträgen dieses Schlüssels. */
export async function highestCounter(db: DbInterface, schluessel: string, feld: string): Promise<number> {
  const z = await db.get<{ v: number }>(
    `SELECT COALESCE(MAX((payload->>$2)::int), 0) AS v FROM jobs
      WHERE dedupe_key = $1 AND status IN ('offen', 'laeuft')`,
    [schluessel, feld],
  );
  return z?.v ?? 0;
}

/** Ein schon offener Auftrag desselben Schlüssels wird umgeplant, nicht verdoppelt. */
export async function writeResubmission(
  db: DbInterface,
  art: string,
  schluessel: string,
  nutzlast: object,
  o: { dueAb: Date; fehler: string; maxAttempts: number },
): Promise<void> {
  await db.run(
    `INSERT INTO jobs (type, payload, dedupe_key, max_attempts, due_at, error_message)
     VALUES ($5, $2, $1, $6, $3, $4)
     ON CONFLICT (dedupe_key) WHERE status = 'offen'
       DO UPDATE SET payload = EXCLUDED.payload, due_at = EXCLUDED.due_at,
                     error_message = EXCLUDED.error_message, updated_at = NOW()`,
    [schluessel, JSON.stringify(nutzlast), o.dueAb, o.fehler, art, o.maxAttempts],
  );
}

export async function openDelete(db: DbInterface, schluessel: string): Promise<void> {
  await db.run(`DELETE FROM jobs WHERE dedupe_key = $1 AND status = 'offen'`, [schluessel]);
}

export interface WaitingRow {
  payload: Record<string, unknown>;
  due_at: Date;
  error_message: string | null;
  created_at: Date | null;
}

/** Wartende und laufende einer Art, nach Fälligkeit. */
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

/** Ohne Nutzlast (ganze Listen) und ohne Konto, denn die Liste sieht der Verwalter. */
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
  progress: Fortschritt | null;
  error_message: string | null;
  updated_at: Date | null;
}
/** Je Art der laufende, sonst der zuletzt beendete, sonst der nächste geplante Auftrag. */
export function letzteJeArt(db: DbInterface, arten: readonly JobKind[]) {
  return db.all<LastStatus>(
    `SELECT DISTINCT ON (type) type, status, progress, error_message, updated_at FROM jobs
      WHERE type = ANY($1)
      ORDER BY type, CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 2 ELSE 1 END, updated_at DESC`,
    [[...arten]],
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
  return db.get<{ status: JobStatus; progress: Fortschritt | null; result: Record<string, unknown> | null }>(
    'SELECT status, progress, result FROM jobs WHERE id = $1 AND user_id = $2',
    [id, uid],
  );
}

/** Was später fällig war, kommt bis `bis` dran. */
export function pullAppointmentsBefore(db: DbInterface, art: string, bis: Date) {
  return db.run(`UPDATE jobs SET due_at = $1 WHERE type = $2 AND status = 'offen' AND due_at > NOW()`, [bis, art]);
}

export async function writeResult(
  db: DbInterface,
  id: string,
  ergebnis: Record<string, unknown> | null,
): Promise<void> {
  await db.run('UPDATE jobs SET result = $2 WHERE id = $1', [id, ergebnis === null ? null : JSON.stringify(ergebnis)]);
}

/** Nur der eigene: Der Schlüssel steht in der Adresse, er allein ist kein Recht. */
export function ownRow(db: DbInterface, art: string, schluessel: string, uid: number) {
  return db.get<{
    status: JobStatus;
    error_message: string | null;
    user_id: number | null;
    progress: Fortschritt | null;
  }>(
    `SELECT status, error_message, user_id, progress FROM jobs
      WHERE type = $3 AND dedupe_key = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`,
    [schluessel, uid, art],
  );
}

/** Ein hängengebliebener zählt nach `deadlineSec` nicht mehr. */
export function countRunningRows(db: DbInterface, art: string, uid: number, deadlineSec: number) {
  return db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM jobs
      WHERE type = $3 AND user_id = $1 AND status IN ('offen', 'laeuft')
        AND created_at > NOW() - make_interval(secs => $2)`,
    [uid, deadlineSec, art],
  );
}

export function deleteOwnRow(db: DbInterface, art: string, schluessel: string, uid: number) {
  return db.run(`DELETE FROM jobs WHERE type = $3 AND dedupe_key = $1 AND user_id = $2 AND status <> 'laeuft'`, [
    schluessel,
    uid,
    art,
  ]);
}

/** Beendete nach Ablauf der Frist; liefert ihre Schlüssel, damit Dateien mitgehen. */
export function deleteEndedRows(db: DbInterface, art: string, deadlineSec: number) {
  return db.all<{ dedupe_key: string }>(
    `DELETE FROM jobs WHERE type = $2 AND status IN ('erledigt', 'fehler', 'abgebrochen')
        AND updated_at < NOW() - make_interval(secs => $1)
     RETURNING dedupe_key`,
    [deadlineSec, art],
  );
}
