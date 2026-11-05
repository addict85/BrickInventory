import * as repo from '../repository/bildStammCdn';
import { meldeUndLiefere } from '../../infra/fehler';

/** Umleiten auf die CDN-Adresse heilt Web und App, ohne verwaiste
 * image_local-Einträge bereinigen zu müssen. Gesucht über den indizierten
 * Dateinamen-Stamm (bild_stamm()). */
const _cache = new Map<string, { url: string | null; at: number }>();
const CACHE_MS = 10 * 60 * 1000;


export function bildStammAusPfad(webPfad: string): string {
  const datei = webPfad.split('/').pop() || '';
  return datei.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
}

export async function cdnFuerFehlendesBild(webPfad: string): Promise<string | null> {
  const gemerkt = _cache.get(webPfad);
  if (gemerkt && Date.now() - gemerkt.at < CACHE_MS) return gemerkt.url;
  const stamm = bildStammAusPfad(webPfad);
  let url: string | null = null;
  if (stamm) {
    const z = await repo.cdnZuBildstamm(stamm).catch(meldeUndLiefere('bilder:cdn nachschlagen', null));
    url = z?.url ?? null;
  }
  // Ältestes Fünftel verdrängen statt alles wegwerfen.
  if (_cache.size > 5000) {
    let n = 0;
    for (const k of _cache.keys()) { _cache.delete(k); if (++n >= 1000) break; }
  }
  _cache.set(webPfad, { url, at: Date.now() });
  return url;
}

/** Für Tests, damit der Plan der Abfrage geprüft werden kann. */
export { CDN_ABFRAGE } from '../repository/bildStammCdn';
