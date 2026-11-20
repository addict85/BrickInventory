/** Googles Widerrufsliste: Mit einem erbeuteten Herstellerschlüssel liesse sich sonst jeder Software-Schlüssel
 * attestieren. Der Job-Prozess legt sie in laufzustand ab; eine halbe Liste wäre schlimmer als die alte. */
export const REVOCATION_STATE = 'attestation_widerruf';
const AT_MOST = 1_000_000;
const CLOCK_SPIEL_MS = 5 * 60_000;

export function readRevocationList(roh: Buffer | string): string[] {
  const j: unknown = JSON.parse(roh.toString());
  const eintraege = (j as { entries?: unknown } | null)?.entries;
  if (!eintraege || typeof eintraege !== 'object' || Array.isArray(eintraege))
    throw new Error('Widerrufsliste ohne entries');
  const nummern = Object.keys(eintraege);
  if (nummern.length > AT_MOST) throw new Error('Widerrufsliste zu lang');
  return nummern.map(n => {
    const status = (eintraege as Record<string, { status?: unknown }>)[n]?.status;
    if (!/^[0-9a-fA-F]{1,64}$/.test(n) || typeof status !== 'string')
      throw new Error(`Widerrufsliste: Eintrag ${n.slice(0, 40)} unlesbar`);
    return n.toLowerCase().replace(/^0+(?=.)/, '');
  });
}

export interface SavedList {
  stand: string;
  nummern: string[];
}

/** null: keine Liste oder älter als [atMostDays]; dann nimmt der Server keinen Schlüssel an. */
export function applicableList(wert: string | null, atMostDays: number, jetzt: Date): ReadonlySet<string> | null {
  if (!wert) return null;
  let l: SavedList;
  try {
    l = JSON.parse(wert) as SavedList;
  } catch {
    return null;
  }
  const alter = jetzt.getTime() - new Date(l?.stand).getTime();
  if (!Array.isArray(l?.nummern) || !(alter >= -CLOCK_SPIEL_MS && alter <= atMostDays * 86_400_000)) return null;
  return new Set(l.nummern);
}
