/** Managing passkeys in the own account; logging in with them happens in routes/auth.ts. */
import { guardFor } from '../api/middleware';
import { perSession, signedInUserId, confirmWithFactor } from '../../src/account/http/login';
import { contractRouter } from '../../src/http/contractRouter';
import { devicesNameValid } from '../../src/account';
import { relyingParty } from '../../src/factors';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';

const NAME_MAX = 60;
const passkeyName = (raw: unknown) =>
  typeof raw === 'string' && raw.trim() ? Array.from(raw.trim()).slice(0, NAME_MAX).join('') : 'Passkey';

export function buildPasskeyRouter(d: Pick<Services, 'account' | 'factors'>) {
  const { requireLoginOrToken } = guardFor(d.account);
  const router = contractRouter('/api/v2/auth');

  router.endpoint('GET /api/v2/auth/passkeys', requireLoginOrToken, async req => {
    return { available: !!relyingParty(), passkeys: await d.factors.accountPasskeys(signedInUserId(req)) };
  });

  // A new login method requires password and browser session: a captured
  // session or a token alone must not mint a permanent access.
  router.endpoint('POST /api/v2/auth/passkey/register/options', requireLoginOrToken, async (req, res) => {
    if (!perSession(req)) failDomain('forbidden', 'session_only');
    const uid = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    const account = await d.account.accountShortOf(uid);
    const options = await d.factors.registrationOptions(uid, account?.username ?? String(uid));
    if (!options) failDomain('unavailable', 'passkey_without_domain');
    return { options };
  });

  router.endpoint('POST /api/v2/auth/passkey/register', requireLoginOrToken, async req => {
    if (!perSession(req)) failDomain('forbidden', 'session_only');
    if (!devicesNameValid(req.input.name)) failDomain('invalid', 'device_name_invalid');
    const fresh = await d.factors.verifyRegistration(
      signedInUserId(req),
      req.input.response,
      passkeyName(req.input.name),
    );
    if (!fresh) failDomain('invalid', 'passkey_invalid');
    d.account.hintInBackground(signedInUserId(req), 'passkey_added', fresh.name);
    return { passkey: fresh };
  });

  router.endpoint('DELETE /api/v2/auth/passkeys/:id', requireLoginOrToken, async (req, res) => {
    const uid = signedInUserId(req);
    const id = req.pathArgs.id;
    if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    return { deleted: (await d.factors.deletePasskey(uid, id)) ? 1 : 0 };
  });
  return router;
}
