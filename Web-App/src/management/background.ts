/** Jobs plus the catalog's image demand: the queue does not know the catalog. */
import type { ManagementContext } from './context';

export async function jobsOverview(
  k: ManagementContext,
  filter: { status?: string | undefined; art?: string | undefined } = {},
) {
  const [overview, bildbedarf] = await Promise.all([k.jobQueue.jobsInOverview(filter), k.images.openImageDemand()]);
  return { ...overview, bildbedarf };
}

/** For the image demand the notes go too. */
export async function clearJobType(k: ManagementContext, kindRaw: string) {
  const r = await k.jobQueue.emptyJobKind(kindRaw);
  return r.art === 'bildbedarf' ? { ...r, entfernt: r.entfernt + (await k.images.emptyImageDemand()) } : r;
}
