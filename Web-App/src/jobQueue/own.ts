/** Jobs an account triggered itself and tracks via their key (e.g. a PDF):
 * reading and deleting happen only under row security and filtered by account. */
import type { JobKind } from './jobs';
import type { JobsContext } from './context';

export function ownJob(k: JobsContext, art: JobKind, key: string, uid: number) {
  return k.eigene.ownRow(art, key, uid);
}

export async function deleteOwn(k: JobsContext, art: JobKind, key: string, uid: number) {
  await k.eigene.deleteOwnRow(art, key, uid);
}

export async function countRunning(k: JobsContext, art: JobKind, uid: number, deadlineSec: number) {
  return (await k.eigene.countRunningRows(art, uid, deadlineSec))?.n ?? 0;
}

/** @returns the keys of the deleted ones, so that their files go along */
export async function deleteEnded(k: JobsContext, art: JobKind, deadlineSec: number): Promise<string[]> {
  return (await k.eigene.deleteEndedRows(art, deadlineSec)).map(r => r.dedupe_key);
}
