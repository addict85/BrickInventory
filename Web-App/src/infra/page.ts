/** The query of a paged list (contract: SEITE). */
export interface PagesWish {
  page?: number | undefined;
  page_size?: number | undefined;
}

export const PAGE_AT_MOST = 500;

/** The caller computes sums over the whole list so that they are the same on every
 * page. Without page_size everything comes: that is how older app versions call. */
export function pageFrom<T>(
  list: T[],
  w: PagesWish,
): { eintraege: T[]; total: number; page: number; page_size: number } {
  const total = list.length;
  if (!w.page_size) return { eintraege: list, total, page: 1, page_size: total };
  const page_size = Math.min(PAGE_AT_MOST, Math.max(1, w.page_size));
  const page = Math.max(1, w.page ?? 1);
  return { eintraege: list.slice((page - 1) * page_size, page * page_size), total, page, page_size };
}
