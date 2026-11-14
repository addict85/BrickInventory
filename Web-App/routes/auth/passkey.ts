/** Passkeys im eigenen Konto verwalten; angemeldet wird mit ihnen in routes/auth.ts. */
import { waechterFuer } from '../api_v1/middleware';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { perSitzung, angemeldeteNutzerId, bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { vertragsRouter, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import { geraeteNameGueltig, vertrauenspartei } from '../../src/konto';
import type { Dienste } from '../../src/dienste';

const NAME_MAX = 60;
const passkeyName = (roh: unknown) =>
  typeof roh === 'string' && roh.trim() ? Array.from(roh.trim()).slice(0, NAME_MAX).join('') : 'Passkey';

export function bauePasskeyRouter(d: Pick<Dienste, 'konto'>) {
  const { requireLoginOrToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  router.get(
    '/passkeys',
    requireLoginOrToken,
    async (req: OffeneAnfrage<'GET /api/v1/auth/passkeys'>, res: Antwort<'GET /api/v1/auth/passkeys'>) => {
      res.json({
        success: true,
        verfuegbar: !!vertrauenspartei(),
        passkeys: await d.konto.passkeysDesKontos(angemeldeteNutzerId(req)),
      });
    },
  );

  // Ein neuer Anmeldeweg verlangt Passwort und Browser-Sitzung: Eine erbeutete
  // Sitzung oder ein Token allein soll keinen dauerhaften Zugang prägen.
  router.post(
    '/passkey/registrieren/optionen',
    requireLoginOrToken,
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/passkey/registrieren/optionen'>,
      res: Antwort<'POST /api/v1/auth/passkey/registrieren/optionen'>,
    ) => {
      if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
      const uid = angemeldeteNutzerId(req);
      if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
      const konto = await d.konto.kontoKurzVon(uid);
      const optionen = await d.konto.registrierungsOptionen(uid, konto?.username ?? String(uid));
      if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
      res.json({ success: true, optionen });
    },
  );

  router.post(
    '/passkey/registrieren',
    requireLoginOrToken,
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/passkey/registrieren'>,
      res: Antwort<'POST /api/v1/auth/passkey/registrieren'>,
    ) => {
      if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
      if (!geraeteNameGueltig(req.eingabe.name)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
      const neu = await d.konto.registrierungPruefen(
        angemeldeteNutzerId(req),
        req.eingabe.antwort,
        passkeyName(req.eingabe.name),
      );
      if (!neu) return sendeFehler(req, res, 400, 'passkey_ungueltig');
      d.konto.hinweisNebenher(angemeldeteNutzerId(req), 'passkey_neu', neu.name);
      res.json({ success: true, passkey: neu });
    },
  );

  router.delete(
    '/passkeys/:id',
    requireLoginOrToken,
    async (
      req: OffeneAnfrage<'DELETE /api/v1/auth/passkeys/:id'>,
      res: Antwort<'DELETE /api/v1/auth/passkeys/:id'>,
    ) => {
      const uid = angemeldeteNutzerId(req);
      const id = req.pfad.id;
      if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
      if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
      res.json({ success: true, deleted: (await d.konto.loeschePasskey(uid, id)) ? 1 : 0 });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
