/** Status of the initial setup for the login page: without an account it shows what's
 * still missing, and explains installing the root certificate. Until setup is
 * complete these are only flags — no names, addresses or keys. Afterwards the
 * page only ever answers "done" and names the certificate, which is public
 * under /ca.crt anyway. */
import { Degradations } from '../infra/result';
import { tlsStand } from '../infra/tlsRoot';
import type { ProfileContext } from './context';

export type StepId = 'database' | 'base_url' | 'https' | 'ca' | 'account' | 'source';
export interface StepState {
  id: StepId;
  ok: boolean;
  required: boolean;
}

// Field names below (erledigt, konfiguriert, ...) are the API contract (src/contract/settings.ts,
// EinrichtungStand) and stay as-is; only identifiers around them are English.
export interface SetupStatusResponse {
  done: boolean;
  configured: boolean;
  steps: StepState[];
  ca: { existing: boolean; fp_hex?: string; valid_until?: string; download: string };
  base_url: string | null;
  https: boolean;
  degraded?: string[];
}

/** The page is public and costs about ten queries per call (decryption, account count):
 * only the first call in a window computes it, even with concurrent ones. */
const CACHE_MS = 5000;
type Cached = Map<boolean, { until: number; response: Promise<SetupStatusResponse> }>;
const cached = (k: ProfileContext) =>
  k.faecher.slot<Cached>('einrichtungStand', () => {
    const m: Cached = new Map();
    k.settings.onGlobalChange(() => m.clear());
    return m;
  });

export function forgetSetupStatus(k: ProfileContext): void {
  cached(k).clear();
}

/** An error while checking is itself information: the row then reads "missing",
 * `degradiert` names the part and the log the reason.
 * Without admin (`isAdmin: false`) the base URL and initial password are left out: a visitor
 * who only reaches the page should not learn that an account still carries the initial password.
 * Both responses are cached separately, or the public page would see the admin's. */
export function setupStatus(k: ProfileContext, { isAdmin = false } = {}): Promise<SetupStatusResponse> {
  const now = k.clock.now();
  const _cached = cached(k);
  const old = _cached.get(isAdmin);
  if (old && old.until > now) return old.response;
  const response = compute(k, isAdmin);
  _cached.set(isAdmin, { until: now + CACHE_MS, response });
  response.catch(() => {
    if (_cached.get(isAdmin)?.response === response) _cached.delete(isAdmin);
  });
  return response;
}

async function compute(kx: ProfileContext, isAdmin: boolean): Promise<SetupStatusResponse> {
  const ca = await tlsStand();
  const k = kx.config;
  const base = {
    ca: {
      existing: !!ca,
      ...(ca ? { fp_hex: ca.fp_hex, cert_sha256: ca.cert_sha256, valid_until: ca.valid_until } : {}),
      download: '/ca.crt',
    },
    base_url: isAdmin ? k.appBaseUrl : null,
    https: k.hinterTls,
  };

  // What couldn't be read reads "missing" and goes into `degradiert`; only the
  // database row is itself the probe.
  const ab = new Degradations();
  const done = !!(await ab.orElse('erledigt', kx.settings.globalValue('einrichtung_erledigt'), null));
  // Once setup is done, decrypting the keys is no longer needed.
  if (done) return { ...base, done: true, configured: true, steps: [] };

  // BrickLink only counts with all four values, as in /settings/einrichtung.
  const has = async (key: string) => !!(await ab.orElse('quelle', kx.settings.globalValue(key), null));
  const rebrickable = await has('rebrickable_api_key');
  const bricklink = (
    await Promise.all(
      ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'].map(has),
    )
  ).every(Boolean);

  const steps: StepState[] = [];
  const database = await kx.db.databaseResponds();
  steps.push({ id: 'database', ok: database, required: true });
  steps.push({ id: 'base_url', ok: !!k.appBaseUrl, required: true });
  steps.push({ id: 'https', ok: k.hinterTls, required: false });
  steps.push({ id: 'ca', ok: !!ca, required: !!k.hinterTls });
  const account = await ab.orElse('konten', kx.account.accountConfigured(isAdmin), false);
  steps.push({ id: 'account', ok: account, required: true });
  steps.push({ id: 'source', ok: rebrickable, required: true });

  return { ...base, done: false, configured: rebrickable || bricklink, steps: steps, ...ab.detail() };
}
