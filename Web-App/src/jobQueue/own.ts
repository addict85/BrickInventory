/** Jobs an account triggered itself and tracks via their key (e.g. a PDF):
 * reading and deleting happen only under row security and filtered by account. */
import type { JobKind } from './jobs';
import type { JobsContext } from './context';

export function ownJob(k: JobsContext, kind: JobKind, key: string, uid: number) {
  return k.ownRows.ownRow(kind, key, uid);
}

export async function deleteOwn(k: JobsContext, kind: JobKind, key: string, uid: number) {
  await k.ownRows.deleteOwnRow(kind, key, uid);
}

export async function countRunning(k: JobsContext, kind: JobKind, uid: number, deadlineSec: number) {
  return (await k.ownRows.countRunningRows(kind, uid, deadlineSec))?.n ?? 0;
}

/** @returns the keys of the deleted ones, so that their files go along */
export async function deleteEnded(k: JobsContext, kind: JobKind, deadlineSec: number): Promise<string[]> {
  return (await k.ownRows.deleteEndedRows(kind, deadlineSec)).map(r => r.dedupe_key);
}
