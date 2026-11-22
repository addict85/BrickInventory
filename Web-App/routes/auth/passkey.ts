/** Managing passkeys in the own account; logging in with them happens in routes/auth.ts. */
import { guardFor } from '../api_v1/middleware';
import { perSession, signedInUserId, confirmWithFactor } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/contractRouter';
import { devicesNameValid } from '../../src/account';
import { relyingParty } from '../../src/factors';
import type { Services } from '../../src/services';
import { fachfehler } from '../../src/infra/errorTexts';

const NAME_MAX = 60;
const passkeyName = (raw: unknown) =>
  typeof raw === 'string' && raw.trim() ? Array.from(raw.trim()).slice(0, NAME_MAX).join('') : 'Passkey';

export function buildPasskeyRouter(d: Pick<Services, 'account' | 'factors'>) {
  const { requireLoginOrToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1/auth');

  router.endpunkt('GET /api/v1/auth/passkeys', requireLoginOrToken, async req => {
    return { verfuegbar: !!relyingParty(), passkeys: await d.factors.accountPasskeys(signedInUserId(req)) };
  });

  // A new login method requires password and browser session: a captured
  // session or a token alone must not mint a permanent access.
  router.endpunkt('POST /api/v1/auth/passkey/registrieren/optionen', requireLoginOrToken, async (req, res) => {
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    const uid = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    const konto = await d.account.accountShortOf(uid);
    const optionen = await d.factors.registrationOptions(uid, konto?.username ?? String(uid));
    if (!optionen) fachfehler('nicht_verfuegbar', 'passkey_ohne_domain');
    return { optionen };
  });

  router.endpunkt('POST /api/v1/auth/passkey/registrieren', requireLoginOrToken, async req => {
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    if (!devicesNameValid(req.eingabe.name)) fachfehler('ungueltig', 'geraetename_ungueltig');
    const neu = await d.factors.verifyRegistration(
      signedInUserId(req),
      req.eingabe.antwort,
      passkeyName(req.eingabe.name),
    );
    if (!neu) fachfehler('ungueltig', 'passkey_ungueltig');
    d.account.hintInBackground(signedInUserId(req), 'passkey_neu', neu.name);
    return { passkey: neu };
  });

  router.endpunkt('DELETE /api/v1/auth/passkeys/:id', requireLoginOrToken, async (req, res) => {
    const uid = signedInUserId(req);
    const id = req.pfad.id;
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    return { deleted: (await d.factors.deletePasskey(uid, id)) ? 1 : 0 };
  });
  return router;
}
