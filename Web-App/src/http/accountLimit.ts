/** How many uploads and event streams an account keeps open at the same time: one should not occupy memory
 * and process for everyone. In memory, because there is exactly one web process. */
import { prozessweit } from '../infra/prozessweit';

export const CONCURRENT = { upload: 2, voucherPdf: 1, strom: 6 } as const;
export type Schranke = keyof typeof CONCURRENT;

/** Per process, not per access: the slot is this process's memory (src/infra/prozessweit.ts). */
const places = () => prozessweit('kontoSchranke', () => new Map<string, number>());

/** @returns the release (callable several times), or null if the account is already at the limit. */
export function receiptsAccountSpace(art: Schranke, konto: number): (() => void) | null {
  const schluessel = `${art}:${konto}`;
  const offen = places();
  const n = offen.get(schluessel) ?? 0;
  if (n >= CONCURRENT[art]) return null;
  offen.set(schluessel, n + 1);
  let frei = false;
  return () => {
    if (frei) return;
    frei = true;
    const rest = (offen.get(schluessel) ?? 1) - 1;
    if (rest > 0) offen.set(schluessel, rest);
    else offen.delete(schluessel);
  };
}
