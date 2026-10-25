/**
 * APP_BASE_URL — die EINE Adresse, unter der dieser Server von aussen zu
 * erreichen ist.
 * Ausführlich: docs/begruendungen/utils/basisUrl.ts.md#basisurl
 */

/** Die konfigurierte Adresse ohne abschliessenden Schraegstrich — oder null. */
export function basisUrl(): string | null {
  const roh = process.env.APP_BASE_URL;
  if (!roh) return null;
  const sauber = roh.replace(/\/+$/, '');
  // Eine Variable, die nur aus Schraegstrichen besteht, ist keine Adresse.
  return sauber || null;
}

/**
 * Ein Hinweis ins Protokoll — EINMAL je Bereich und Prozess.
 * Ausführlich: docs/begruendungen/utils/basisUrl.ts.md#gemeldet
 */
const _gemeldet = new Set<string>();
export function hinweisOhneBasisUrl(bereich: string, folge: string): void {
  if (_gemeldet.has(bereich)) return;
  _gemeldet.add(bereich);
  console.warn(`⚠️  [${bereich}] APP_BASE_URL ist nicht gesetzt — ${folge} Siehe README.md.`);
}

