import { fachfehler } from './errorTexts';
/** Einmal gelesen statt an drei Stellen mit eigener Schreibweise. */
import { konfig } from './config';
import { prozessweit } from './prozessweit';

export function basisUrl(): string | null {
  return konfig().appBaseUrl;
}

// Einmal je Bereich: Aufrufer laufen in Schleifen.
export function hintWithoutBaseUrl(bereich: string, sequence: string): void {
  const _reported = prozessweit('basisUrlGemeldet', () => new Set<string>());
  if (_reported.has(bereich)) return;
  _reported.add(bereich);
  console.warn(`⚠️  [${bereich}] APP_BASE_URL ist nicht gesetzt — ${sequence} Siehe README.md.`);
}

/** Für Links in Mails, nie aus Kopfzeilen: Host oder X-Forwarded-Host liessen
 * sich auf eine fremde Seite lenken — auch ein „Testserver" steht oft im Netz. */
export function mailBasisUrl(): string | null {
  const basis = basisUrl();
  if (!basis) hintWithoutBaseUrl('auth', 'Links in E-Mails werden nicht verschickt.');
  return basis;
}

/** Erreicht die App den Server verschlüsselt? Nur dann gibt es unbegrenzte Zugänge und ein Pinning der CA. */
export function viaTls(basis: string | null): boolean {
  return /^https:\/\//i.test(basis ?? '');
}

export function unlimitedOnlyWithTls(basis: string | null): void {
  if (!viaTls(basis)) fachfehler('ungueltig', 'unbegrenzt_nur_https');
}
