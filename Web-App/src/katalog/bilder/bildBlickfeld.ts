import { beiHaushaltsaenderung } from '../../haushalt';
import type { KatalogKontext } from '../kontext';

/** Anleitungen liegen unter der Setnummer: Ihr Vorhandensein verrät, was jemand
 * besitzt. Set-, Teile- und Figurenbilder sind Katalog und gehen an jedes
 * angemeldete Konto (Set-Bilder seit 0105: die Katalogsuche zeigt sie für alle). */
export const dateiStamm = (setNumber: string) => String(setNumber).replace(/[^a-z0-9-]/gi, '_');

type Stand = { nummern: Set<string>; anleitungen: Set<string>; am: number };
const _cache = new Map<number, Stand>();
beiHaushaltsaenderung(() => _cache.clear());
// Ein Treffer gilt eine Minute; eine Absage wird nach zwei Sekunden neu
// gefragt, damit ein eben erfasstes Set sein Bild sofort zeigt.
const TREFFER_MS = 60_000,
  ABSAGE_MS = 2_000,
  KONTEN_HOECHSTENS = 1000;

async function lade(k: KatalogKontext, uid: number): Promise<Stand> {
  const zeilen = await k.bildBlickfeld.setsImBlickfeld(await k.haushalt.haushalt.blickfeldIds(uid));
  const s: Stand = { nummern: new Set(), anleitungen: new Set(), am: Date.now() };
  for (const z of zeilen) {
    s.nummern.add(dateiStamm(z.set_number));
    if (z.besitz) s.anleitungen.add(dateiStamm(z.set_number));
  }
  if (_cache.size >= KONTEN_HOECHSTENS) _cache.delete(_cache.keys().next().value!);
  _cache.set(uid, s);
  return s;
}

async function imBlickfeld(
  k: KatalogKontext,
  uid: number,
  stamm: string,
  art: 'nummern' | 'anleitungen',
): Promise<boolean> {
  const s = _cache.get(uid);
  const alter = s ? Date.now() - s.am : Infinity;
  const drin = !!s?.[art].has(stamm);
  if (drin && alter < TREFFER_MS) return true;
  if (s && !drin && alter < ABSAGE_MS) return false;
  return (await lade(k, uid))[art].has(stamm);
}

/** Pfad unter /images/: unter sets/ nur Dateien, keine Unterordner. */
export async function bildFreigegeben(_uid: number, segmente: string[]): Promise<boolean> {
  return segmente[0] !== 'sets' || segmente.length === 2;
}

/** Namen wie src/katalog/instructions.ts sie vergibt: <set>_<n|bdp|brickinstructions>.pdf */
export async function anleitungFreigegeben(k: KatalogKontext, uid: number, segmente: string[]): Promise<boolean> {
  const m = segmente.length === 1 ? /^(.+)_(\d+|bdp|brickinstructions)\.pdf$/.exec(segmente[0]!) : null;
  return !!m && imBlickfeld(k, uid, m[1]!, 'anleitungen');
}

/** Merkliste und Preisalarm zählen mit: Ein Platzhalter von dort ist kein fremder. */
export async function setNummerImBlickfeld(k: KatalogKontext, uid: number, setNumber: string): Promise<boolean> {
  return imBlickfeld(k, uid, dateiStamm(setNumber), 'nummern');
}
