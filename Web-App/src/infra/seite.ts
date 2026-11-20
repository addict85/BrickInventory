/** Die Abfrage einer geblätterten Liste (Vertrag: SEITE). */
export interface PagesWish {
  page?: number | undefined;
  page_size?: number | undefined;
}

export const PAGE_AT_MOST = 500;

/** Summen rechnet der Aufrufer über die ganze Liste, damit sie auf jeder Seite
 * gleich sind. Ohne page_size kommt alles: So rufen ältere App-Stände auf. */
export function pageFrom<T>(
  liste: T[],
  w: PagesWish,
): { eintraege: T[]; total: number; page: number; page_size: number } {
  const total = liste.length;
  if (!w.page_size) return { eintraege: liste, total, page: 1, page_size: total };
  const page_size = Math.min(PAGE_AT_MOST, Math.max(1, w.page_size));
  const page = Math.max(1, w.page ?? 1);
  return { eintraege: liste.slice((page - 1) * page_size, page * page_size), total, page, page_size };
}
