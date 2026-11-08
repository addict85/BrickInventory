import { fehlerWerfen } from './fehlerTexte';
/** Einmal gelesen statt an drei Stellen mit eigener Schreibweise.
 * Ausführlich: docs/begruendungen/src/infra/basisUrl.ts.md#basisurl */
import { konfig } from './konfig';

export function basisUrl(): string | null {
  return konfig().appBaseUrl;
}

// Einmal je Bereich: Aufrufer laufen in Schleifen. Ausführlich: docs/begruendungen/src/infra/basisUrl.ts.md#gemeldet
const _gemeldet = new Set<string>();
export function hinweisOhneBasisUrl(bereich: string, folge: string): void {
  if (_gemeldet.has(bereich)) return;
  _gemeldet.add(bereich);
  console.warn(`⚠️  [${bereich}] APP_BASE_URL ist nicht gesetzt — ${folge} Siehe README.md.`);
}

/** Für Links in Mails, nie aus Kopfzeilen: Host oder X-Forwarded-Host liessen
 * sich auf eine fremde Seite lenken — auch ein „Testserver" steht oft im Netz. */
export function mailBasisUrl(): string | null {
  const basis = basisUrl();
  if (!basis) hinweisOhneBasisUrl('auth', 'Links in E-Mails werden nicht verschickt.');
  return basis;
}

/** Erreicht die App den Server verschlüsselt? Nur dann gibt es unbegrenzte Zugänge und ein Pinning der CA. */
export function ueberTls(basis: string | null): boolean {
  return /^https:\/\//i.test(basis ?? '');
}

export function unbegrenztNurMitTls(basis: string | null): void {
  if (!ueberTls(basis)) fehlerWerfen('unbegrenzt_nur_https', 400);
}
