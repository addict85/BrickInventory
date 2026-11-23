/** The app's device key and the release of sensitive steps; only with an
 * app token, a browser session confirms with password and second factor. */
import { guardFor } from './middleware';
import { familyFrom } from '../../src/devices';
import { isAppToken } from '../../src/account/http/stepGuard';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';

const family = (req: AuthedRequest) => (isAppToken(req) ? familyFrom(req.apiUser) : null);

export function buildDeviceRouter(d: Pick<Services, 'account' | 'devices'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('POST /api/v2/device/key/nonce', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('forbidden', 'app_token_only');
    const nonce = await d.devices.newNonce(f);
    if (!nonce) failDomain('forbidden', 'device_key_deadline');
    return { nonce };
  });

  router.endpoint('POST /api/v2/device/key', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('forbidden', 'app_token_only');
    if (!req.input.chain) failDomain('invalid', 'device_key_attestation');
    await d.devices.depositKey(f, req.input.chain);
    return {};
  });

  router.endpoint('POST /api/v2/device/step/challenge', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('forbidden', 'app_token_only');
    return { ...(await d.devices.newChallenge(f, req.input.action)) };
  });

  router.endpoint('POST /api/v2/device/step/approval', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('forbidden', 'app_token_only');
    const r = await d.devices.resolveOne(f, req.input.challenge, req.input.signature);
    if (!r) failDomain('invalid', 'step_signature_invalid');
    return { action: r.action, valid_until: r.bis };
  });
  return router;
}
