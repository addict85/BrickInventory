/** Aufträge plus Bildbedarf des Katalogs: Die Warteschlange kennt den Katalog nicht. */
import type { VerwaltungKontext } from './kontext';

export async function auftragsUebersicht(
  k: VerwaltungKontext,
  filter: { status?: string | undefined; art?: string | undefined } = {},
) {
  const [uebersicht, bildbedarf] = await Promise.all([
    k.auftraege.auftraegeImUeberblick(filter),
    k.katalog.offenerBildbedarf(),
  ]);
  return { ...uebersicht, bildbedarf };
}

/** Beim Bildbedarf gehen auch die Notizen. */
export async function auftragsArtLeeren(k: VerwaltungKontext, artRoh: string) {
  const r = await k.auftraege.leereAuftragsArt(artRoh);
  return r.art === 'bildbedarf' ? { ...r, entfernt: r.entfernt + (await k.katalog.leereBildbedarf()) } : r;
}
