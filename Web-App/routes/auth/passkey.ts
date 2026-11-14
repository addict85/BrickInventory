/** Passkeys im eigenen Konto verwalten; angemeldet wird mit ihnen in routes/auth.ts. */
import { waechterFuer } from '../api_v1/middleware';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { perSitzung, angemeldeteNutzerId, bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import { geraeteNameGueltig, vertrauenspartei } from '../../src/konto';
import type { Dienste } from '../../src/dienste';

const NAME_MAX = 60;
const passkeyName = (roh: unknown) =>
  typeof roh === 'string' && roh.trim() ? Array.from(roh.trim()).slice(0, NAME_MAX).join('') : 'Passkey';

export function bauePasskeyRouter(d: Pick<Dienste, 'konto'>) {
  const { requireLoginOrToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1/auth');

  router.endpunkt('GET /api/v1/auth/passkeys', requireLoginOrToken, async req => {
    return { verfuegbar: !!vertrauenspartei(), passkeys: await d.konto.passkeysDesKontos(angemeldeteNutzerId(req)) };
  });

  // Ein neuer Anmeldeweg verlangt Passwort und Browser-Sitzung: Eine erbeutete
  // Sitzung oder ein Token allein soll keinen dauerhaften Zugang prägen.
  router.endpunkt('POST /api/v1/auth/passkey/registrieren/optionen', requireLoginOrToken, async (req, res) => {
    if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
    const uid = angemeldeteNutzerId(req);
    if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
    const konto = await d.konto.kontoKurzVon(uid);
    const optionen = await d.konto.registrierungsOptionen(uid, konto?.username ?? String(uid));
    if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
    return { optionen };
  });

  router.endpunkt('POST /api/v1/auth/passkey/registrieren', requireLoginOrToken, async (req, res) => {
    if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
    if (!geraeteNameGueltig(req.eingabe.name)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
    const neu = await d.konto.registrierungPruefen(
      angemeldeteNutzerId(req),
      req.eingabe.antwort,
      passkeyName(req.eingabe.name),
    );
    if (!neu) return sendeFehler(req, res, 400, 'passkey_ungueltig');
    d.konto.hinweisNebenher(angemeldeteNutzerId(req), 'passkey_neu', neu.name);
    return { passkey: neu };
  });

  router.endpunkt('DELETE /api/v1/auth/passkeys/:id', requireLoginOrToken, async (req, res) => {
    const uid = angemeldeteNutzerId(req);
    const id = req.pfad.id;
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
    return { deleted: (await d.konto.loeschePasskey(uid, id)) ? 1 : 0 };
  });

  router.use(fehlerAntwort);
  return router;
}
