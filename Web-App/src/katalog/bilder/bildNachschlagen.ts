import { katalog } from '../prozess';
import { Zwischenspeicher } from '../../infra/zwischenspeicher';

/** Umleiten auf die CDN-Adresse heilt Web und App, ohne verwaiste
 * image_local-Einträge bereinigen zu müssen. Gesucht über den indizierten
 * Dateinamen-Stamm (bild_stamm()). */
const CACHE_MS = 10 * 60 * 1000;
const cdnSpeicher = () =>
  katalog().faecher.fach('cdnZuPfad', () => new Zwischenspeicher<string, { url: string | null }>(5000, CACHE_MS));

export function bildStammAusPfad(webPfad: string): string {
  const datei = webPfad.split('/').pop() || '';
  return datei.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
}

export async function cdnFuerFehlendesBild(webPfad: string): Promise<string | null> {
  const gemerkt = cdnSpeicher().hole(webPfad);
  if (gemerkt) return gemerkt.url;
  const stamm = bildStammAusPfad(webPfad);
  let url: string | null = null;
  if (stamm) {
    const z = await katalog().bildStammCdn.cdnZuBildstamm(stamm);
    url = z?.url ?? null;
  }
  cdnSpeicher().setze(webPfad, { url });
  return url;
}

/** Für Tests, damit der Plan der Abfrage geprüft werden kann. */
export { CDN_ABFRAGE } from '../repository/bildStammCdn';
