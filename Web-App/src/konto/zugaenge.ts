/** Die App-Zugänge eines Kontos in den Einstellungen: lesen und einzeln oder
 * alle anderen beenden. Der Token-Cache gälte sonst noch kurz nach. */
import { hashToken } from './geraeteToken';
import { hinweisNebenher } from './kontoHinweis';
import { kontoBereich } from './prozess';
import { leereTokenCache } from './tokenCache';

export function zugaengeListe(uid: number) {
  return kontoBereich().konten.zugaengeDesKontos(uid);
}

/** Einen fremden Zugang erfährt der Inhaber per Mail; den eigenen hat er selbst beendet. */
export async function zugangBeenden(uid: number, kennung: string, eigenesGeraet: boolean): Promise<number> {
  const { anzahl, label } = await kontoBereich().konten.zugangLoeschen(uid, kennung);
  if (anzahl) {
    leereTokenCache();
    if (!eigenesGeraet) hinweisNebenher(uid, 'zugang_beendet', label ?? undefined);
  }
  return anzahl;
}

/** @param eigenerToken der Token der Anfrage im Klartext; er bleibt */
export async function andereZugaengeBeenden(uid: number, eigenerToken: string | null): Promise<number> {
  const n = await kontoBereich().konten.andereZugaengeLoeschen(uid, eigenerToken ? hashToken(eigenerToken) : null);
  if (n) leereTokenCache();
  return n;
}
