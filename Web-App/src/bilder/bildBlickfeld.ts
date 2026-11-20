import type { ImagesContext } from './kontext';

/** Anleitungen liegen unter der Setnummer: Ihr Vorhandensein verrät, was jemand
 * besitzt. Set-, Teile- und Figurenbilder sind Katalog und gehen an jedes
 * angemeldete Konto (Set-Bilder seit 0105: die Katalogsuche zeigt sie für alle). */
export const fileMaster = (setNumber: string) => String(setNumber).replace(/[^a-z0-9-]/gi, '_');

type Stand = { nummern: Set<string>; anleitungen: Set<string>; am: number };
/** Je Satz Dienste; eine Haushaltsänderung leert ihn, weil sie das Blickfeld verschiebt. */
const merker = (k: ImagesContext) =>
  k.faecher.fach('blickfeld', () => {
    const m = new Map<number, Stand>();
    k.haushalt.atHouseholdChange(() => m.clear());
    return m;
  });
// Ein Treffer gilt eine Minute; eine Absage wird nach zwei Sekunden neu
// gefragt, damit ein eben erfasstes Set sein Bild sofort zeigt.
const HITS_MS = 60_000,
  REJECTION_MS = 2_000,
  ACCOUNTS_AT_MOST = 1000;

async function lade(k: ImagesContext, uid: number): Promise<Stand> {
  const zeilen = await k.bildBlickfeld.setsInScope(await k.haushalt.scopeIds(uid));
  const s: Stand = { nummern: new Set(), anleitungen: new Set(), am: k.uhr.jetzt() };
  for (const z of zeilen) {
    s.nummern.add(fileMaster(z.set_number));
    if (z.besitz) s.anleitungen.add(fileMaster(z.set_number));
  }
  const _cache = merker(k);
  if (_cache.size >= ACCOUNTS_AT_MOST) _cache.delete(_cache.keys().next().value!);
  _cache.set(uid, s);
  return s;
}

async function inScope(k: ImagesContext, uid: number, stamm: string, art: 'nummern' | 'anleitungen'): Promise<boolean> {
  const s = merker(k).get(uid);
  const alter = s ? k.uhr.jetzt() - s.am : Infinity;
  const drin = !!s?.[art].has(stamm);
  if (drin && alter < HITS_MS) return true;
  if (s && !drin && alter < REJECTION_MS) return false;
  return (await lade(k, uid))[art].has(stamm);
}

/** Pfad unter /images/: unter sets/ nur Dateien, keine Unterordner. */
export async function imageReleased(_uid: number, segmente: string[]): Promise<boolean> {
  return segmente[0] !== 'sets' || segmente.length === 2;
}

/** Namen wie src/katalog/instructions.ts sie vergibt: <set>_<n|bdp|brickinstructions>.pdf */
export async function instructionReleased(k: ImagesContext, uid: number, segmente: string[]): Promise<boolean> {
  const m = segmente.length === 1 ? /^(.+)_(\d+|bdp|brickinstructions)\.pdf$/.exec(segmente[0]!) : null;
  return !!m && inScope(k, uid, m[1]!, 'anleitungen');
}

/** Merkliste und Preisalarm zählen mit: Ein Platzhalter von dort ist kein fremder. */
export async function setNumberInScope(k: ImagesContext, uid: number, setNumber: string): Promise<boolean> {
  return inScope(k, uid, fileMaster(setNumber), 'nummern');
}
