/**
 * Passkeys: Verwalten im Konto, Anmelden auf der Anmeldeseite. Hängt wie
 * routes/auth.ts unter /api/v1/auth (server.ts).
 */
import express from 'express';
import { handleRouteError, pfadParam } from '../src/infra/httpError';
import { requireLoginOrToken, angemeldeteNutzerId, assertLoginAllowed, establishSession, flaggeGesetzt, perSitzung } from '../utils/auth';
import { bestaetigePasswort } from '../utils/passwortBestaetigung';
import { ipThrottle } from '../utils/loginLimiter';
import { sendeFehler } from '../src/infra/fehlerTexte';
import * as P from '../utils/passkeys';
import * as K from '../utils/konten';

const router = express.Router();

/** Längster Name eines Passkeys in der Liste. */
const NAME_MAX = 60;
const passkeyName = (roh: unknown) =>
  (typeof roh === 'string' && roh.trim() ? Array.from(roh.trim()).slice(0, NAME_MAX).join('') : 'Passkey');

router.get('/passkeys', requireLoginOrToken, async (req, res) => {
  try {
    res.json({ success: true, verfuegbar: !!P.vertrauenspartei(),
      passkeys: await P.passkeysDesKontos(angemeldeteNutzerId(req)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Einen neuen Anmeldeweg anlegen verlangt das Passwort und eine Browser-Sitzung:
// Eine erbeutete Sitzung oder ein Token allein soll keinen dauerhaften Zugang prägen.
router.post('/passkey/registrieren/optionen', requireLoginOrToken, async (req, res) => {
  try {
    if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
    const uid = angemeldeteNutzerId(req);
    if (!await bestaetigePasswort(req, res, uid, req.body?.password)) return;
    const konto = await K.kontoKurz(uid);
    const optionen = await P.registrierungsOptionen(uid, konto?.username ?? String(uid));
    if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
    res.json({ success: true, optionen });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/passkey/registrieren', requireLoginOrToken, async (req, res) => {
  try {
    if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
    const neu = await P.registrierungPruefen(angemeldeteNutzerId(req), req.body?.antwort, passkeyName(req.body?.name));
    if (!neu) return sendeFehler(req, res, 400, 'passkey_ungueltig');
    res.json({ success: true, passkey: neu });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.delete('/passkeys/:id', requireLoginOrToken, async (req, res) => {
  try {
    const uid = angemeldeteNutzerId(req);
    const id = parseInt(pfadParam(req, 'id'));
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (!await bestaetigePasswort(req, res, uid, req.body?.password)) return;
    res.json({ success: true, deleted: await P.loeschePasskey(uid, id) ? 1 : 0 });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Öffentlich (siehe OEFFENTLICH in routes/api_v1/middleware.ts). Die Drossel
// begrenzt, wie viele Challenges eine Adresse anlegen kann.
router.post('/passkey/anmelden/optionen', ipThrottle('passkey-optionen', 60, 60 * 60 * 1000), async (req, res) => {
  try {
    const zweck = req.body?.zweck === 'zweiter_faktor' ? 'zweiter_faktor' : 'anmelden';
    const optionen = await P.anmeldeOptionen(zweck);
    if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
    res.json({ success: true, optionen });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/** Anmelden ohne Passwort. Nur für den Browser: Es entsteht eine Sitzung, kein Token. */
router.post('/passkey/anmelden', ipThrottle('passkey-anmelden', 30, 60 * 60 * 1000), async (req, res) => {
  try {
    const uid = await P.anmeldungPruefen(req.body?.antwort, 'anmelden');
    if (!uid) return sendeFehler(req, res, 401, 'passkey_ungueltig');
    const user = await K.kontoVoll(uid);
    if (!user) return sendeFehler(req, res, 401, 'passkey_ungueltig');
    const gesperrt = assertLoginAllowed(user);
    if (gesperrt) return sendeFehler(req, res, gesperrt.status, gesperrt.code);
    await establishSession(req, { userId: user.id, username: user.username, isAdmin: flaggeGesetzt(user.is_admin) });
    res.json({ success: true, user: { id: user.id, username: user.username, is_admin: flaggeGesetzt(user.is_admin),
      mustChangePassword: user.must_change_password === 1 || user.must_change_password === true } });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export = router;
