/** Der Geräteschlüssel der App und die Freigabe heikler Schritte; nur mit
 * App-Token, eine Browser-Sitzung bestätigt mit Passwort und zweitem Faktor. */
import { guardFor } from './middleware';
import { familyFrom } from '../../src/devices';
import { isAppToken } from '../../src/account/http/stepGuard';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';
import { fachfehler } from '../../src/infra/errorTexts';

const familie = (req: AuthedRequest) => (isAppToken(req) ? familyFrom(req.apiUser) : null);

export function buildDeviceRouter(d: Pick<Dienste, 'account' | 'devices'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('POST /api/v1/geraet/schluessel/nonce', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    const nonce = await d.devices.newNonce(f);
    if (!nonce) fachfehler('verboten', 'geraeteschluessel_frist');
    return { nonce };
  });

  router.endpunkt('POST /api/v1/geraet/schluessel', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    if (!req.eingabe.kette) fachfehler('ungueltig', 'geraeteschluessel_attestation');
    await d.devices.depositKey(f, req.eingabe.kette);
    return {};
  });

  router.endpunkt('POST /api/v1/geraet/schritt/challenge', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    return { ...(await d.devices.newChallenge(f, req.eingabe.aktion)) };
  });

  router.endpunkt('POST /api/v1/geraet/schritt/freigabe', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    const r = await d.devices.resolveOne(f, req.eingabe.challenge, req.eingabe.signatur);
    if (!r) fachfehler('ungueltig', 'schritt_signatur_ungueltig');
    return { aktion: r.aktion, gueltig_bis: r.bis };
  });
  return router;
}
