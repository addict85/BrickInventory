/** Aufträge plus Bildbedarf des Katalogs: Die Warteschlange kennt den Katalog nicht. */
import type { ManagementContext } from './context';

export async function jobsOverview(
  k: ManagementContext,
  filter: { status?: string | undefined; art?: string | undefined } = {},
) {
  const [uebersicht, bildbedarf] = await Promise.all([
    k.auftraege.auftraegeImUeberblick(filter),
    k.bilder.offenerBildbedarf(),
  ]);
  return { ...uebersicht, bildbedarf };
}

/** Beim Bildbedarf gehen auch die Notizen. */
export async function clearJobType(k: ManagementContext, artRoh: string) {
  const r = await k.auftraege.leereAuftragsArt(artRoh);
  return r.art === 'bildbedarf' ? { ...r, entfernt: r.entfernt + (await k.bilder.leereBildbedarf()) } : r;
}
