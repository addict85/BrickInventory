/** Googles Widerrufsliste: Mit einem erbeuteten Herstellerschlüssel liesse sich sonst jeder Software-Schlüssel
 * attestieren. Der Job-Prozess legt sie in laufzustand ab; eine halbe Liste wäre schlimmer als die alte. */
export const WIDERRUF_ZUSTAND = 'attestation_widerruf';
const HOECHSTENS = 1_000_000;
const UHR_SPIEL_MS = 5 * 60_000;

export function leseWiderrufsliste(roh: Buffer | string): string[] {
  const j: unknown = JSON.parse(roh.toString());
  const eintraege = (j as { entries?: unknown } | null)?.entries;
  if (!eintraege || typeof eintraege !== 'object' || Array.isArray(eintraege))
    throw new Error('Widerrufsliste ohne entries');
  const nummern = Object.keys(eintraege);
  if (nummern.length > HOECHSTENS) throw new Error('Widerrufsliste zu lang');
  return nummern.map(n => {
    const status = (eintraege as Record<string, { status?: unknown }>)[n]?.status;
    if (!/^[0-9a-fA-F]{1,64}$/.test(n) || typeof status !== 'string')
      throw new Error(`Widerrufsliste: Eintrag ${n.slice(0, 40)} unlesbar`);
    return n.toLowerCase().replace(/^0+(?=.)/, '');
  });
}

export interface GespeicherteListe {
  stand: string;
  nummern: string[];
}

/** null: keine Liste oder älter als [hoechstensTage]; dann nimmt der Server keinen Schlüssel an. */
export function geltendeListe(
  wert: string | null,
  hoechstensTage: number,
  jetzt = new Date(),
): ReadonlySet<string> | null {
  if (!wert) return null;
  let l: GespeicherteListe;
  try {
    l = JSON.parse(wert) as GespeicherteListe;
  } catch {
    return null;
  }
  const alter = jetzt.getTime() - new Date(l?.stand).getTime();
  if (!Array.isArray(l?.nummern) || !(alter >= -UHR_SPIEL_MS && alter <= hoechstensTage * 86_400_000)) return null;
  return new Set(l.nummern);
}
