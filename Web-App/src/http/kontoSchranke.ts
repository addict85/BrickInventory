/** Wie viele Uploads und Ereignisströme ein Konto zugleich offen hält: Eines soll Speicher
 * und Prozess nicht für alle belegen. Im Speicher, denn es gibt genau einen Web-Prozess. */
import { prozessweit } from '../infra/prozessweit';

export const GLEICHZEITIG = { upload: 2, gutscheinPdf: 1, strom: 6 } as const;
export type Schranke = keyof typeof GLEICHZEITIG;

/** Je Prozess, nicht je Zugang: Der Platz ist Speicher dieses Prozesses (src/infra/prozessweit.ts). */
const plaetze = () => prozessweit('kontoSchranke', () => new Map<string, number>());

/** @returns die Freigabe (mehrfach rufbar), oder null, wenn das Konto schon am Limit ist. */
export function belegeKontoPlatz(art: Schranke, konto: number): (() => void) | null {
  const schluessel = `${art}:${konto}`;
  const offen = plaetze();
  const n = offen.get(schluessel) ?? 0;
  if (n >= GLEICHZEITIG[art]) return null;
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
