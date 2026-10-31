/** Einmal gelesen statt an drei Stellen mit eigener Schreibweise.
 * Ausführlich: docs/begruendungen/src/infra/basisUrl.ts.md#basisurl */
import { konfig } from './konfig';

export function basisUrl(): string | null {
  return konfig().appBaseUrl;
}

// Ausführlich: docs/begruendungen/src/infra/basisUrl.ts.md#gemeldet
const _gemeldet = new Set<string>();
export function hinweisOhneBasisUrl(bereich: string, folge: string): void {
  if (_gemeldet.has(bereich)) return;
  _gemeldet.add(bereich);
  console.warn(`⚠️  [${bereich}] APP_BASE_URL ist nicht gesetzt — ${folge} Siehe README.md.`);
}

