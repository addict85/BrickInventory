/** Offene Ströme prüfen ihren Zugang im Takt; endet ein Zugang in diesem
 * Prozess (Widerruf, Abmelden, neue Sitzungsversion, fremder Widerruf per
 * NOTIFY), sollen sie es sofort merken und nicht erst beim nächsten Takt. */
const hoerer = new Set<() => void>();

export function beiZugangsAenderung(f: () => void): () => void {
  hoerer.add(f);
  return () => {
    hoerer.delete(f);
  };
}

export function meldeZugangsAenderung(): void {
  for (const f of [...hoerer]) f();
}
