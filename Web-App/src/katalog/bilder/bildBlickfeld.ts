import { beiHaushaltsaenderung, scopeIds } from '../../haushalt/haushalt';
import * as repo from '../repository/bildBlickfeld';

/** Set-Bilder und Anleitungen liegen unter der Setnummer: Ihr Vorhandensein
 * verrät, was jemand besitzt. Teile- und Figurenbilder sind Katalog. */
export const dateiStamm = (setNumber: string) => String(setNumber).replace(/[^a-z0-9-]/gi, '_');

type Stand = { bilder: Set<string>; anleitungen: Set<string>; am: number };
const _cache = new Map<number, Stand>();
beiHaushaltsaenderung(() => _cache.clear());
// Ein Treffer gilt eine Minute; eine Absage wird nach zwei Sekunden neu
// gefragt, damit ein eben erfasstes Set sein Bild sofort zeigt.
const TREFFER_MS = 60_000, ABSAGE_MS = 2_000, KONTEN_HOECHSTENS = 1000;

async function lade(uid: number): Promise<Stand> {
  const zeilen = await repo.setsImBlickfeld(await scopeIds(uid));
  const s: Stand = { bilder: new Set(), anleitungen: new Set(), am: Date.now() };
  for (const z of zeilen) {
    s.bilder.add(dateiStamm(z.set_number));
    if (z.besitz) s.anleitungen.add(dateiStamm(z.set_number));
  }
  if (_cache.size >= KONTEN_HOECHSTENS) _cache.delete(_cache.keys().next().value!);
  _cache.set(uid, s);
  return s;
}

async function imBlickfeld(uid: number, stamm: string, art: 'bilder' | 'anleitungen'): Promise<boolean> {
  const s = _cache.get(uid);
  const alter = s ? Date.now() - s.am : Infinity;
  const drin = !!s?.[art].has(stamm);
  if (drin && alter < TREFFER_MS) return true;
  if (s && !drin && alter < ABSAGE_MS) return false;
  return (await lade(uid))[art].has(stamm);
}

/** Pfad unter /images/: nur sets/ hängt am Blickfeld. */
export async function bildFreigegeben(uid: number, segmente: string[]): Promise<boolean> {
  if (segmente[0] !== 'sets') return true;
  if (segmente.length !== 2) return false;
  const stamm = segmente[1]!.replace(/_thumb(\.[^.]+)$/, '$1').replace(/\.[^.]+$/, '');
  return imBlickfeld(uid, stamm, 'bilder');
}

/** Namen wie src/katalog/instructions.ts sie vergibt: <set>_<n|bdp|brickinstructions>.pdf */
export async function anleitungFreigegeben(uid: number, segmente: string[]): Promise<boolean> {
  const m = segmente.length === 1 ? /^(.+)_(\d+|bdp|brickinstructions)\.pdf$/.exec(segmente[0]!) : null;
  return !!m && imBlickfeld(uid, m[1]!, 'anleitungen');
}

export async function setBildSichtbar(uid: number, setNumber: string): Promise<boolean> {
  return imBlickfeld(uid, dateiStamm(setNumber), 'bilder');
}

