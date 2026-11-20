/** Aufträge, die ein Konto selbst angestossen hat und über ihren Schlüssel verfolgt (etwa ein PDF):
 * Gelesen und gelöscht wird nur unter Zeilenschutz und nach Konto gefiltert. */
import type { JobKind } from './auftraege';
import type { JobsContext } from './kontext';

export function ownJob(k: JobsContext, art: JobKind, schluessel: string, uid: number) {
  return k.eigene.ownRow(art, schluessel, uid);
}

export async function deleteOwn(k: JobsContext, art: JobKind, schluessel: string, uid: number) {
  await k.eigene.deleteOwnRow(art, schluessel, uid);
}

export async function countRunning(k: JobsContext, art: JobKind, uid: number, deadlineSec: number) {
  return (await k.eigene.countRunningRows(art, uid, deadlineSec))?.n ?? 0;
}

/** @returns die Schlüssel der gelöschten, damit ihre Dateien mitgehen */
export async function deleteEnded(k: JobsContext, art: JobKind, deadlineSec: number): Promise<string[]> {
  return (await k.eigene.deleteEndedRows(art, deadlineSec)).map(r => r.dedupe_key);
}
