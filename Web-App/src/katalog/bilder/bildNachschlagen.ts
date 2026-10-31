import * as repo from '../repository/bildStammCdn';
import { meldeUndLiefere } from '../../infra/httpError';

/**
 * Fehlt eine lokale Bilddatei, wird auf die CDN-Adresse aus dem Katalog
 * umgeleitet — das heilt Web und App, ohne verwaiste image_local-Einträge
 * bereinigen zu müssen. Gesucht wird über den Dateinamen-Stamm (ohne Ordner,
 * Endung und _thumb), den bild_stamm() je Tabelle indiziert (Migration 0067).
 */
const _cache = new Map<string, { url: string | null; at: number }>();
const CACHE_MS = 10 * 60 * 1000;


/** Der Stamm eines Webpfads: '/images/parts/3001_4_thumb.jpg' → '3001_4'. */
export function bildStammAusPfad(webPfad: string): string {
  const datei = webPfad.split('/').pop() || '';
  return datei.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
}

/** @returns die CDN-Adresse zum fehlenden Bild, oder null */
export async function cdnFuerFehlendesBild(webPfad: string): Promise<string | null> {
  const gemerkt = _cache.get(webPfad);
  if (gemerkt && Date.now() - gemerkt.at < CACHE_MS) return gemerkt.url;
  const stamm = bildStammAusPfad(webPfad);
  let url: string | null = null;
  if (stamm) {
    const z = await repo.cdnZuBildstamm(stamm).catch(meldeUndLiefere('bilder:cdn nachschlagen', null));
    url = z?.url ?? null;
  }
  // Ältestes Fünftel verdrängen statt alles wegwerfen (wie src/katalog/bilder/images.ts).
  if (_cache.size > 5000) {
    let n = 0;
    for (const k of _cache.keys()) { _cache.delete(k); if (++n >= 1000) break; }
  }
  _cache.set(webPfad, { url, at: Date.now() });
  return url;
}

/** Für Tests: die Abfrage selbst, damit ihr Plan geprüft werden kann. */
export { CDN_ABFRAGE } from '../repository/bildStammCdn';
