/** Google's revocation list: with a stolen manufacturer key any software key could otherwise
 * be attested. The job process stores it in laufzustand; half a list would be worse than the old one. */
export const REVOCATION_STATE = 'attestation_widerruf';
const AT_MOST = 1_000_000;
const CLOCK_SLACK_MS = 5 * 60_000;

export function readRevocationList(raw: Buffer | string): string[] {
  const j: unknown = JSON.parse(raw.toString());
  const entries = (j as { entries?: unknown } | null)?.entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Widerrufsliste ohne entries');
  const numbers = Object.keys(entries);
  if (numbers.length > AT_MOST) throw new Error('Widerrufsliste zu lang');
  return numbers.map(n => {
    const status = (entries as Record<string, { status?: unknown }>)[n]?.status;
    if (!/^[0-9a-fA-F]{1,64}$/.test(n) || typeof status !== 'string')
      throw new Error(`Widerrufsliste: Eintrag ${n.slice(0, 40)} unlesbar`);
    return n.toLowerCase().replace(/^0+(?=.)/, '');
  });
}

export interface SavedList {
  state: string;
  /** Key of the lists already stored in run_state; renaming it would void them until the next fetch. */
  nummern: string[];
}

/** null: no list or older than [atMostDays]; then the server accepts no key. */
export function applicableList(value: string | null, atMostDays: number, now: Date): ReadonlySet<string> | null {
  if (!value) return null;
  let l: SavedList;
  try {
    l = JSON.parse(value) as SavedList;
  } catch {
    return null;
  }
  const alter = now.getTime() - new Date(l?.state).getTime();
  if (!Array.isArray(l?.nummern) || !(alter >= -CLOCK_SLACK_MS && alter <= atMostDays * 86_400_000)) return null;
  return new Set(l.nummern);
}
