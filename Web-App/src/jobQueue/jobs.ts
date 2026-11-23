import type { z } from 'zod';

/** Per kind the zod schema of the payload. Every area adds its kinds via `declare module`
 * (the area's jobKinds.ts): queuing is checked without this area knowing them. */
// biome-ignore lint/suspicious/noEmptyInterface: the areas extend it
export interface JobPayloads {}
export type JobKind = keyof JobPayloads & string;
export type PayloadSchema<A extends JobKind> = JobPayloads[A] extends z.ZodType ? JobPayloads[A] : never;
export type Payload<A extends JobKind> = z.output<PayloadSchema<A>>;
export type PayloadInput<A extends JobKind> = z.input<PayloadSchema<A>>;

/** Stored in jobs.status (migration 0136); API v1 shows the former German values (contract/management.ts). */
export const JOB_STATUSES = ['pending', 'running', 'done', 'error', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Progress {
  done?: number;
  total?: number;
  text?: string | null;
  [k: string]: unknown;
}

/** What a service needs from the running job: report state, stop at the signal. */
export interface JobRun {
  readonly signal?: AbortSignal;
  progress?(f: Progress): Promise<boolean>;
}

/** Throws the reason for the abort; between two steps of a long run. */
export function checkAbort(run: JobRun | undefined): void {
  run?.signal?.throwIfAborted();
}

export interface JobRow {
  id: string;
  type: JobKind;
  payload: Record<string, unknown>;
  user_id: number | null;
  dedupe_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  error_message: string | null;
}

export interface Enqueue {
  userId?: number | null;
  /** If an open job with this key already exists, no second one is added. */
  key?: string;
  maxAttempts?: number;
  afterSeconds?: number;
  /** Takes precedence over afterSeconds. */
  dueFrom?: Date;
  progress?: Progress;
}

export type Claim = Pick<JobRow, 'id' | 'locked_by'>;

/** If a remote side throttles, the whole kind waits, not one job. */

export interface Pause {
  type: string;
  until_at: Date;
  reason: string | null;
  level: number;
}

/** What a handler gets from the worker; the domain services only know this, not the worker. */
export interface JobContext {
  /** false: the job no longer belongs to this run (aborted, reassigned). */
  heartbeat(): Promise<boolean>;
  progress(f: Progress): Promise<boolean>;
  /** Aborted, reassigned or the process ends: fetches and loops stop. */
  readonly signal: AbortSignal;
  /** A long job stops at the next safe point. */
  readonly ended: boolean;
  readonly attempt: number;
}

/** Is returned and continued later without counting as failed. */
export class JobInterrupted extends Error {
  constructor() {
    super('Auftrag unterbrochen');
  }
}

export class JobLost extends Error {
  constructor() {
    super('Auftrag gehört nicht mehr diesem Lauf');
  }
}

/** The remote side throttles or a quota is exhausted. `zaehlt`
 * decides whether it counts as an attempt (and thus ends at some point). */
export class JobMove extends Error {
  constructor(
    readonly bis: Date,
    readonly reason: string,
    readonly counts = false,
  ) {
    super(reason);
  }
}
