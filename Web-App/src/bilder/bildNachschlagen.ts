import { Zwischenspeicher } from '../infra/zwischenspeicher';
import type { BilderKontext } from './kontext';

/** Umleiten auf die CDN-Adresse heilt Web und App, ohne verwaiste
 * image_local-Einträge bereinigen zu müssen. Gesucht über den indizierten
 * Dateinamen-Stamm (bild_stamm()). */
const CACHE_MS = 10 * 60 * 1000;
const cdnSpeicher = (k: BilderKontext) =>
  k.faecher.fach('cdnZuPfad', () => new Zwischenspeicher<string, { url: string | null }>(5000, CACHE_MS));

export function bildStammAusPfad(webPfad: string): string {
  const datei = webPfad.split('/').pop() || '';
  return datei.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
}

export async function cdnFuerFehlendesBild(k: BilderKontext, webPfad: string): Promise<string | null> {
  const gemerkt = cdnSpeicher(k).hole(webPfad);
  if (gemerkt) return gemerkt.url;
  const stamm = bildStammAusPfad(webPfad);
  let url: string | null = null;
  if (stamm) {
    const z = await k.bildStammCdn.cdnZuBildstamm(stamm);
    url = z?.url ?? null;
  }
  cdnSpeicher(k).setze(webPfad, { url });
  return url;
}

/** Für Tests, damit der Plan der Abfrage geprüft werden kann. */
export { CDN_ABFRAGE } from './repository/bildStammCdn';
