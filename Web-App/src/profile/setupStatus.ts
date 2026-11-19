/** Status of the initial setup for the login page: without an account it shows what's
 * still missing, and explains installing the root certificate. Until setup is
 * complete these are only flags — no names, addresses or keys. Afterwards the
 * page only ever answers "done" and names the certificate, which is public
 * under /ca.crt anyway. */
import { Abstriche } from '../infra/ergebnis';
import { tlsStand } from '../infra/tlsWurzel';
import type { ProfileContext } from './context';

export type StepId = 'datenbank' | 'basis_url' | 'https' | 'ca' | 'konto' | 'quelle';
export interface StepState {
  id: StepId;
  ok: boolean;
  pflicht: boolean;
}

// Field names below (erledigt, konfiguriert, ...) are the API contract (src/vertrag/einstellungen.ts,
// EinrichtungStand) and stay as-is; only identifiers around them are English.
export interface SetupStatusResponse {
  erledigt: boolean;
  konfiguriert: boolean;
  schritte: StepState[];
  ca: { vorhanden: boolean; fp_hex?: string; gueltig_bis?: string; download: string };
  basis_url: string | null;
  https: boolean;
  degradiert?: string[];
}

/** The page is public and costs about ten queries per call (decryption, account count):
 * only the first call in a window computes it, even with concurrent ones. */
const CACHE_MS = 5000;
type Cached = Map<boolean, { until: number; response: Promise<SetupStatusResponse> }>;
const cached = (k: ProfileContext) =>
  k.faecher.fach<Cached>('einrichtungStand', () => {
    const m: Cached = new Map();
    k.einstellungen.onGlobalChange(() => m.clear());
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
  const now = k.uhr.jetzt();
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
  const k = kx.konfig;
  const base = {
    ca: {
      vorhanden: !!ca,
      ...(ca ? { fp_hex: ca.fp_hex, zert_sha256: ca.zert_sha256, gueltig_bis: ca.gueltig_bis } : {}),
      download: '/ca.crt',
    },
    basis_url: isAdmin ? k.appBaseUrl : null,
    https: k.hinterTls,
  };

  // What couldn't be read reads "missing" and goes into `degradiert`; only the
  // database row is itself the probe.
  const ab = new Abstriche();
  const done = !!(await ab.oder('erledigt', kx.einstellungen.globalValue('einrichtung_erledigt'), null));
  // Once setup is done, decrypting the keys is no longer needed.
  if (done) return { ...base, erledigt: true, konfiguriert: true, schritte: [] };

  // BrickLink only counts with all four values, as in /settings/einrichtung.
  const has = async (key: string) => !!(await ab.oder('quelle', kx.einstellungen.globalValue(key), null));
  const rebrickable = await has('rebrickable_api_key');
  const bricklink = (
    await Promise.all(
      ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'].map(has),
    )
  ).every(Boolean);

  const steps: StepState[] = [];
  const database = await kx.db.datenbankAntwortet();
  steps.push({ id: 'datenbank', ok: database, pflicht: true });
  steps.push({ id: 'basis_url', ok: !!k.appBaseUrl, pflicht: true });
  steps.push({ id: 'https', ok: k.hinterTls, pflicht: false });
  steps.push({ id: 'ca', ok: !!ca, pflicht: !!k.hinterTls });
  const account = await ab.oder('konten', kx.konto.kontoEingerichtet(isAdmin), false);
  steps.push({ id: 'konto', ok: account, pflicht: true });
  steps.push({ id: 'quelle', ok: rebrickable, pflicht: true });

  return { ...base, erledigt: false, konfiguriert: rebrickable || bricklink, schritte: steps, ...ab.angabe() };
}
