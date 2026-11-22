/** Read once instead of in three places with their own spelling. */
import { konfig } from './config';
import { prozessweit } from './prozessweit';

export function basisUrl(): string | null {
  return konfig().appBaseUrl;
}

// Once per area: callers run in loops.
export function hintWithoutBaseUrl(bereich: string, sequence: string): void {
  const _reported = prozessweit('basisUrlGemeldet', () => new Set<string>());
  if (_reported.has(bereich)) return;
  _reported.add(bereich);
  console.warn(`⚠️  [${bereich}] APP_BASE_URL ist nicht gesetzt — ${sequence} Siehe README.md.`);
}

/** For links in mails, never from headers: Host or X-Forwarded-Host could
 * be steered to a foreign site — even a "test server" is often on the net. */
export function mailBasisUrl(): string | null {
  const basis = basisUrl();
  if (!basis) hintWithoutBaseUrl('auth', 'Links in E-Mails werden nicht verschickt.');
  return basis;
}

/** Does the app reach the server encrypted? Only then is there CA pinning. */
export function viaTls(basis: string | null): boolean {
  return /^https:\/\//i.test(basis ?? '');
}
