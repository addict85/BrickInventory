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
  const router = contractRouter('/api/v1');

  router.endpoint('POST /api/v1/geraet/schluessel/nonce', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('verboten', 'nur_mit_app_token');
    const nonce = await d.devices.newNonce(f);
    if (!nonce) failDomain('verboten', 'geraeteschluessel_frist');
    return { nonce };
  });

  router.endpoint('POST /api/v1/geraet/schluessel', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('verboten', 'nur_mit_app_token');
    if (!req.eingabe.kette) failDomain('ungueltig', 'geraeteschluessel_attestation');
    await d.devices.depositKey(f, req.eingabe.kette);
    return {};
  });

  router.endpoint('POST /api/v1/geraet/schritt/challenge', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('verboten', 'nur_mit_app_token');
    return { ...(await d.devices.newChallenge(f, req.eingabe.aktion)) };
  });

  router.endpoint('POST /api/v1/geraet/schritt/freigabe', requireToken, async req => {
    const f = family(req);
    if (!f) failDomain('verboten', 'nur_mit_app_token');
    const r = await d.devices.resolveOne(f, req.eingabe.challenge, req.eingabe.signatur);
    if (!r) failDomain('ungueltig', 'schritt_signatur_ungueltig');
    return { aktion: r.aktion, gueltig_bis: r.bis };
  });
  return router;
}
