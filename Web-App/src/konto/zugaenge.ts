/** Die App-Zugänge eines Kontos in den Einstellungen: lesen und einzeln oder
 * alle anderen beenden. Der Token-Cache gälte sonst noch kurz nach. */
import { hashToken } from './geraeteToken';
import { hinweisNebenher } from './kontoHinweis';
import { leereTokenCache } from './tokenCache';
import type { KontoKontext } from './kontext';

export function zugaengeListe(k: KontoKontext, uid: number) {
  return k.konten.zugaengeDesKontos(uid);
}

/** Einen fremden Zugang erfährt der Inhaber per Mail; den eigenen hat er selbst beendet. */
export async function zugangBeenden(
  k: KontoKontext,
  uid: number,
  kennung: string,
  eigenesGeraet: boolean,
): Promise<number> {
  const { anzahl, label } = await k.konten.zugangLoeschen(uid, kennung);
  if (anzahl) {
    leereTokenCache(k);
    if (!eigenesGeraet) hinweisNebenher(k, uid, 'zugang_beendet', label ?? undefined);
  }
  return anzahl;
}

/** @param eigenerToken der Token der Anfrage im Klartext; er bleibt */
export async function andereZugaengeBeenden(
  k: KontoKontext,
  uid: number,
  eigenerToken: string | null,
): Promise<number> {
  const n = await k.konten.andereZugaengeLoeschen(uid, eigenerToken ? hashToken(eigenerToken) : null);
  if (n) leereTokenCache(k);
  return n;
}
