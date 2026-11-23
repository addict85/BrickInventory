/** Web UI and app read the same response. */
import type { JobKind } from './jobs';
import { pullBefore, repeat, abortJob, endPause } from './service';
import { hasSchedule, planNext, pullPlanBefore } from './schedule';
import { failDomain } from '../infra/errorTexts';
import type { JobsContext } from './context';

const HEARTBEAT_APPLIES_SEC = 120;
const STATUS = ['pending', 'running', 'error', 'cancelled', 'done'] as const;

function checkKind(k: JobsContext, kind: string): JobKind {
  if (!k.kinds.fromValue(kind)) failDomain('invalid', 'unknown_job');
  return kind as JobKind;
}

/** Payloads stay outside: they carry whole lists. Without a filter only what
 * is still pending; the summary counts failed ones per kind. */
export async function jobsInOverview(
  k: JobsContext,
  filter: { status?: string | undefined; kind?: string | undefined } = {},
) {
  const status = (filter.status ? filter.status.split(',') : ['pending', 'running']).filter(s =>
    (STATUS as readonly string[]).includes(s),
  );
  const kind = filter.kind ? checkKind(k, filter.kind) : null;
  const [jobs, summary, pauses, heartbeat] = await Promise.all([
    k.jobs.jobList(status, kind),
    k.jobs.countsByKindAndStatus(),
    k.jobs.runningPauses(),
    k.runState.readState('jobs_lebenszeichen'),
  ]);
  const alterSec = heartbeat ? Math.round((k.clock.now() - new Date(heartbeat).getTime()) / 1000) : null;
  return {
    jobs,
    summary,
    pauses,
    job_process: {
      heartbeat,
      age_seconds: alterSec,
      running: alterSec !== null && alterSec < HEARTBEAT_APPLIES_SEC,
    },
  };
}

/** For a scheduled kind the next regular appointment is pending afterwards. */
export async function cancelJob(k: JobsContext, key: number) {
  // The response names the identifier as text like the overview (bigint).
  const id = String(key);
  const a = await abortJob(k, id);
  if (!a) failDomain('conflict', 'job_not_changeable');
  await planNext(k, a.type);
  return { id, status: 'cancelled' };
}

export async function retryJob(k: JobsContext, key: number) {
  const id = String(key);
  if (!(await repeat(k, id))) failDomain('conflict', 'job_not_changeable');
  return { id, status: 'pending' };
}

/** Scheduled appointments stay. */
export async function emptyJobKind(k: JobsContext, kindRaw: string) {
  const kind = checkKind(k, kindRaw);
  return { kind, removed: await k.jobs.emptyKind(kind) };
}

export async function jobKindNow(k: JobsContext, kindRaw: string) {
  const kind = checkKind(k, kindRaw);
  await endPause(k, kind);
  const started = hasSchedule(k, kind) ? await pullPlanBefore(k, kind) : (await pullBefore(k, kind)) > 0;
  return { kind, started };
}
