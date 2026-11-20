/** Aufträge plus Bildbedarf des Katalogs: Die Warteschlange kennt den Katalog nicht. */
import type { ManagementContext } from './context';

export async function jobsOverview(
  k: ManagementContext,
  filter: { status?: string | undefined; art?: string | undefined } = {},
) {
  const [uebersicht, bildbedarf] = await Promise.all([k.jobQueue.jobsInOverview(filter), k.images.openImageDemand()]);
  return { ...uebersicht, bildbedarf };
}

/** Beim Bildbedarf gehen auch die Notizen. */
export async function clearJobType(k: ManagementContext, kindRaw: string) {
  const r = await k.jobQueue.emptyJobKind(kindRaw);
  return r.art === 'bildbedarf' ? { ...r, entfernt: r.entfernt + (await k.images.emptyImageDemand()) } : r;
}
