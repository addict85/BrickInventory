import type { ImagesContext } from './context';

/** Instructions are stored under the set number: their presence reveals what someone
 * owns. Set, part and figure images are catalog and go to every
 * logged-in account (set images since 0105: the catalog search shows them for everyone). */
export const fileMaster = (setNumber: string) => String(setNumber).replace(/[^a-z0-9-]/gi, '_');

type Stand = { nummern: Set<string>; anleitungen: Set<string>; am: number };
/** Per set of services; a household change clears it because it shifts the scope. */
const merker = (k: ImagesContext) =>
  k.faecher.slot('blickfeld', () => {
    const m = new Map<number, Stand>();
    k.household.atHouseholdChange(() => m.clear());
    return m;
  });
// A hit applies for a minute; a refusal is asked again after two
// seconds, so that a set just captured shows its image immediately.
const HITS_MS = 60_000,
  REJECTION_MS = 2_000,
  ACCOUNTS_AT_MOST = 1000;

async function lade(k: ImagesContext, uid: number): Promise<Stand> {
  const rows = await k.bildBlickfeld.setsInScope(await k.household.scopeIds(uid));
  const s: Stand = { nummern: new Set(), anleitungen: new Set(), am: k.uhr.jetzt() };
  for (const z of rows) {
    s.nummern.add(fileMaster(z.set_number));
    if (z.besitz) s.anleitungen.add(fileMaster(z.set_number));
  }
  const _cache = merker(k);
  if (_cache.size >= ACCOUNTS_AT_MOST) _cache.delete(_cache.keys().next().value!);
  _cache.set(uid, s);
  return s;
}

async function inScope(
  k: ImagesContext,
  uid: number,
  master: string,
  art: 'nummern' | 'anleitungen',
): Promise<boolean> {
  const s = merker(k).get(uid);
  const alter = s ? k.uhr.jetzt() - s.am : Infinity;
  const inside = !!s?.[art].has(master);
  if (inside && alter < HITS_MS) return true;
  if (s && !inside && alter < REJECTION_MS) return false;
  return (await lade(k, uid))[art].has(master);
}

/** Path under /images/: under sets/ only files, no subfolders. */
export async function imageReleased(_uid: number, segments: string[]): Promise<boolean> {
  return segments[0] !== 'sets' || segments.length === 2;
}

/** Names as src/catalog/instructions.ts assigns them: <set>_<n|bdp|brickinstructions>.pdf */
export async function instructionReleased(k: ImagesContext, uid: number, segments: string[]): Promise<boolean> {
  const m = segments.length === 1 ? /^(.+)_(\d+|bdp|brickinstructions)\.pdf$/.exec(segments[0]!) : null;
  return !!m && inScope(k, uid, m[1]!, 'anleitungen');
}

/** Wishlist and price alert count as well: a placeholder from there is not a foreign one. */
export async function setNumberInScope(k: ImagesContext, uid: number, setNumber: string): Promise<boolean> {
  return inScope(k, uid, fileMaster(setNumber), 'nummern');
}
