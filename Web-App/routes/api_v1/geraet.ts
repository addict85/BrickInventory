/** Der Geräteschlüssel der App und die Freigabe heikler Schritte; nur mit
 * App-Token, eine Browser-Sitzung bestätigt mit Passwort und zweitem Faktor. */
import { waechterFuer } from './middleware';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { familieAus } from '../../src/konto';
import { istAppToken } from '../../src/konto/http/schrittschutz';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

const familie = (req: AuthedRequest) => (istAppToken(req) ? familieAus(req.apiUser) : null);

export function baueGeraetRouter(d: Pick<Dienste, 'konto'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  router.post(
    '/geraet/schluessel/nonce',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/geraet/schluessel/nonce'>,
      res: Antwort<'POST /api/v1/geraet/schluessel/nonce'>,
    ) => {
      const f = familie(req);
      if (!f) return sendeFehler(req, res, 403, 'nur_mit_app_token');
      const nonce = await d.konto.neueNonce(f);
      if (!nonce) return sendeFehler(req, res, 403, 'geraeteschluessel_frist');
      res.json({ success: true, nonce });
    },
  );

  router.post(
    '/geraet/schluessel',
    requireToken,
    async (req: Anfrage<'POST /api/v1/geraet/schluessel'>, res: Antwort<'POST /api/v1/geraet/schluessel'>) => {
      const f = familie(req);
      if (!f) return sendeFehler(req, res, 403, 'nur_mit_app_token');
      if (!req.eingabe.kette) return sendeFehler(req, res, 400, 'geraeteschluessel_attestation');
      const r = await d.konto.hinterlegeSchluessel(f, req.eingabe.kette);
      if (typeof r === 'object') {
        // Der Grund gehört ins Protokoll: Die App kann ihn nicht beheben, der Betreiber (Fingerabdruck) schon.
        console.warn(`[geraet] Attestation von Konto ${f.uid} abgewiesen: ${r.abgewiesen}`);
        return sendeFehler(req, res, 400, 'geraeteschluessel_attestation');
      }
      if (r === 'ungueltig') return sendeFehler(req, res, 400, 'geraeteschluessel_ungueltig');
      if (r === 'anderer') return sendeFehler(req, res, 409, 'geraeteschluessel_vorhanden');
      if (r === 'frist_vorbei') return sendeFehler(req, res, 403, 'geraeteschluessel_frist');
      res.json({ success: true });
    },
  );

  router.post(
    '/geraet/schritt/challenge',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/geraet/schritt/challenge'>,
      res: Antwort<'POST /api/v1/geraet/schritt/challenge'>,
    ) => {
      const f = familie(req);
      if (!f) return sendeFehler(req, res, 403, 'nur_mit_app_token');
      const c = await d.konto.neueChallenge(f, req.eingabe.aktion);
      if (c === 'kein_schluessel') return sendeFehler(req, res, 403, 'geraeteschluessel_fehlt');
      res.json({ success: true, ...c });
    },
  );

  router.post(
    '/geraet/schritt/freigabe',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/geraet/schritt/freigabe'>,
      res: Antwort<'POST /api/v1/geraet/schritt/freigabe'>,
    ) => {
      const f = familie(req);
      if (!f) return sendeFehler(req, res, 403, 'nur_mit_app_token');
      const r = await d.konto.loeseEin(f, req.eingabe.challenge, req.eingabe.signatur);
      if (!r) return sendeFehler(req, res, 400, 'schritt_signatur_ungueltig');
      res.json({ success: true, aktion: r.aktion, gueltig_bis: r.bis });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
