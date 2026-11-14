/** Der Geräteschlüssel der App und die Freigabe heikler Schritte; nur mit
 * App-Token, eine Browser-Sitzung bestätigt mit Passwort und zweitem Faktor. */
import { waechterFuer } from './middleware';
import { familieAus } from '../../src/geraete';
import { istAppToken } from '../../src/konto/http/schrittschutz';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { fachfehler } from '../../src/infra/fehlerTexte';

const familie = (req: AuthedRequest) => (istAppToken(req) ? familieAus(req.apiUser) : null);

export function baueGeraetRouter(d: Pick<Dienste, 'konto' | 'geraete'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('POST /api/v1/geraet/schluessel/nonce', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    const nonce = await d.geraete.neueNonce(f);
    if (!nonce) fachfehler('verboten', 'geraeteschluessel_frist');
    return { nonce };
  });

  router.endpunkt('POST /api/v1/geraet/schluessel', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    if (!req.eingabe.kette) fachfehler('ungueltig', 'geraeteschluessel_attestation');
    const r = await d.geraete.hinterlegeSchluessel(f, req.eingabe.kette);
    if (typeof r === 'object') {
      // Der Grund gehört ins Protokoll: Die App kann ihn nicht beheben, der Betreiber (Fingerabdruck) schon.
      console.warn(`[geraet] Attestation von Konto ${f.uid} abgewiesen: ${r.abgewiesen}`);
      fachfehler('ungueltig', 'geraeteschluessel_attestation');
    }
    if (r === 'ungueltig') fachfehler('ungueltig', 'geraeteschluessel_ungueltig');
    if (r === 'anderer') fachfehler('konflikt', 'geraeteschluessel_vorhanden');
    if (r === 'frist_vorbei') fachfehler('verboten', 'geraeteschluessel_frist');
    return {};
  });

  router.endpunkt('POST /api/v1/geraet/schritt/challenge', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    const c = await d.geraete.neueChallenge(f, req.eingabe.aktion);
    if (c === 'kein_schluessel') fachfehler('verboten', 'geraeteschluessel_fehlt');
    return { ...c };
  });

  router.endpunkt('POST /api/v1/geraet/schritt/freigabe', requireToken, async req => {
    const f = familie(req);
    if (!f) fachfehler('verboten', 'nur_mit_app_token');
    const r = await d.geraete.loeseEin(f, req.eingabe.challenge, req.eingabe.signatur);
    if (!r) fachfehler('ungueltig', 'schritt_signatur_ungueltig');
    return { aktion: r.aktion, gueltig_bis: r.bis };
  });
  return router;
}
