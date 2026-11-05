/** Aufträge plus Bildbedarf des Katalogs: Die Warteschlange kennt den Katalog nicht. */
import * as auftraege from '../auftraege/hintergrund';
import { leereBildbedarf, offenerBildbedarf } from '../katalog/bilder/bildbedarf';

export { auftragAbbrechen, auftragWiederholen, auftragsArtJetzt } from '../auftraege/hintergrund';

export async function auftragsUebersicht(filter: { status?: string | undefined; art?: string | undefined } = {}) {
  const [uebersicht, bildbedarf] = await Promise.all([auftraege.auftraegeImUeberblick(filter), offenerBildbedarf()]);
  return { ...uebersicht, bildbedarf };
}

/** Beim Bildbedarf gehen auch die Notizen. */
export async function auftragsArtLeeren(artRoh: string) {
  const r = await auftraege.leereAuftragsArt(artRoh);
  return r.art === 'bildbedarf' ? { ...r, entfernt: r.entfernt + await leereBildbedarf() } : r;
}
