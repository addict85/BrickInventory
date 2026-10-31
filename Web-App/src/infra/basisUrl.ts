/**
 * APP_BASE_URL — die EINE Adresse, unter der dieser Server von aussen zu
 * erreichen ist.
 * Ausführlich: docs/begruendungen/src/infra/basisUrl.ts.md#basisurl
 */
import { konfig } from './konfig';

/** Die konfigurierte Adresse ohne abschliessenden Schraegstrich — oder null. */
export function basisUrl(): string | null {
  return konfig().appBaseUrl;
}

/**
 * Ein Hinweis ins Protokoll — EINMAL je Bereich und Prozess.
 * Ausführlich: docs/begruendungen/src/infra/basisUrl.ts.md#gemeldet
 */
const _gemeldet = new Set<string>();
export function hinweisOhneBasisUrl(bereich: string, folge: string): void {
  if (_gemeldet.has(bereich)) return;
  _gemeldet.add(bereich);
  console.warn(`⚠️  [${bereich}] APP_BASE_URL ist nicht gesetzt — ${folge} Siehe README.md.`);
}

