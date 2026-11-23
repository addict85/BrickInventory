/** Jobs plus the catalog's image demand: the queue does not know the catalog. */
import type { ManagementContext } from './context';

export async function jobsOverview(
  k: ManagementContext,
  filter: { status?: string | undefined; kind?: string | undefined } = {},
) {
  const [overview, image_demand] = await Promise.all([k.jobQueue.jobsInOverview(filter), k.images.openImageDemand()]);
  return { ...overview, image_demand };
}

/** For the image demand the notes go too. */
export async function clearJobType(k: ManagementContext, kindRaw: string) {
  const r = await k.jobQueue.emptyJobKind(kindRaw);
  return r.kind === 'image_demand' ? { ...r, removed: r.removed + (await k.images.emptyImageDemand()) } : r;
}
