/** Benutzerverwaltung für Verwalter: Jede Änderung verlangt Passwort und
 * zweiten Faktor des Verwalters und steht im Protokoll. */
import { protokolliere } from '../../src/verwaltung/dienst';
import * as K from '../../src/konto/konten';
import { meldeHaushaltsaenderung } from '../../src/haushalt/haushalt';
import { fehlerAntwort, pfadParam } from '../../src/infra/httpAntwort';
import { revokeAllSessions, USERNAME_RE, leereTokenCache } from '../../src/konto/auth';
import { nutzerId, angemeldeteNutzerId, bestaetigeMitFaktor, nutzerName } from '../../src/konto/http/anmeldung';
import { hinweisNebenher, verwalterHinweisNebenher } from '../../src/konto/kontoHinweis';
import { strictBool } from '../../src/infra/validate';
import { passwortMangel } from '../../src/infra/passwortRegel';
import { requireApiAdmin } from '../api_v1/middleware';
import { sendeFehler, alsDoppelt } from '../../src/infra/fehlerTexte';
import * as zf from '../../src/konto/zweiterFaktor';
import { loescheKontoDateien } from '../../src/gutscheine/gutscheinDateien';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';

const router = vertragsRouter();
const requireAdmin = requireApiAdmin;

router.get('/users', requireAdmin, async (_req, res: Antwort<'GET /api/v1/auth/users'>) => {
  const users = await K.kontenListe();
  res.json({ success: true, users });
});

router.post('/users', requireAdmin, async (req, res: Antwort<'POST /api/v1/auth/users'>) => {
  const { username, password } = req.body;
  if (!username || !password) return sendeFehler(req, res, 400, 'benutzername_passwort');
  if (!USERNAME_RE.test(String(username)))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  const mangel = passwortMangel(password, username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  // Streng: Die Zeichenkette "false" ist in JavaScript wahr und legte einen
  // Verwalter an.
  const roh = req.body.is_admin ?? req.body.isAdmin;
  const alsVerwalter = roh === undefined ? false : strictBool(roh, 'is_admin');
  // Passwort bestätigen und protokollieren — eine erbeutete Sitzung soll keinen
  // Verwalter anlegen.
  const verwalter = angemeldeteNutzerId(req);
  if (!await bestaetigeMitFaktor(req, res, verwalter, req.body?.admin_password)) return;
  // Wie bei der Registrierung auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
  if (await K.nameVergeben(username, 0)) return sendeFehler(req, res, 409, 'benutzername_vergeben');
  const neu = await K.legeKontoAn(username, password, alsVerwalter).catch(alsDoppelt('benutzername_vergeben'));
  if (neu === null) return sendeFehler(req, res, 409, 'benutzername_vergeben');
  await protokolliere(verwalter, neu, 'konto_angelegt');
  if (alsVerwalter) await protokolliere(verwalter, neu, 'verwalter_ernannt');
  if (alsVerwalter) verwalterHinweisNebenher('verwalter_ernannt', { konto: String(username), durch: nutzerName(req) ?? '' });
  res.json({ success: true });
});

router.put('/users/:id/admin', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/admin'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  // Streng: "false" ist in JavaScript wahr und entzöge sonst keine Rechte.
  const soll = strictBool(req.body.is_admin, 'is_admin');
  if (targetId === nutzerId(req) && !soll)
    return sendeFehler(req, res, 400, 'eigene_adminrolle');
  if (!await K.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  const r = await K.setzeVerwalterRolle(targetId, soll);
  if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (r.geaendert) await protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');
  if (r.geaendert && soll) verwalterHinweisNebenher('verwalter_ernannt',
    { konto: (await K.kontoKurz(targetId))?.username ?? String(targetId), durch: nutzerName(req) ?? '' });

  // Sitzungen enden, weil istVerwalter() zuerst das nie nachgeführte
  // `req.session.isAdmin` fragt; ein Entzug wirkte sonst im offenen Fenster nicht.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-admin
  res.json({ success: true });
});

router.put('/users/:id/aktiv', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/aktiv'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  const soll = strictBool(req.body.is_active, 'is_active');
  if (!Number.isInteger(targetId)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (targetId === nutzerId(req)) return sendeFehler(req, res, 400, 'eigenes_konto_deaktivieren');
  if (!await K.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  const r = await K.setzeAktiv(targetId, soll);
  if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (r.geaendert) await protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
  res.json({ success: true, is_active: soll });
});

// Für Registrierungen, deren Bestätigungsmail nie ankam: Der Verwalter bürgt für die Adresse.
router.put('/users/:id/freischalten', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/freischalten'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  if (!Number.isInteger(targetId) || !await K.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  const r = await K.schalteRegistrierungFrei(targetId);
  if (r !== 'ok') return sendeFehler(req, res, 409, r === 'vergeben' ? 'email_vergeben' : 'konto_nicht_wartend');
  await protokolliere(angemeldeteNutzerId(req), targetId, 'konto_freigeschaltet');
  res.json({ success: true });
});

/** Ohne aktuelles Passwort des Ziels, aber mit dem des Verwalters.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-password */
router.put('/users/:id/password', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/password'>) => {
  const { password } = req.body || {};
  const targetId = parseInt(pfadParam(req, 'id'));
  if (!targetId || targetId === nutzerId(req))
    return sendeFehler(req, res, 400, 'eigenes_konto_passwort');
  const mangel = passwortMangel(password, (await K.kontoKurz(targetId))?.username);
  if (mangel) return sendeFehler(req, res, 400, mangel);

  // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
  // eine offene Verwaltersitzung allein genügt dafür nicht.
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  if (!await K.setzeFremdesPasswort(targetId, password)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  await protokolliere(angemeldeteNutzerId(req), targetId, 'passwort_gesetzt');
  // Wie beim entfernten Faktor: Eine Übernahme durch eine erbeutete Verwaltersitzung bliebe sonst unbemerkt.
  const durch = nutzerName(req) ?? '';
  hinweisNebenher(targetId, 'passwort_durch_verwalter', undefined, { durch });
  verwalterHinweisNebenher('verwaltung_passwort_gesetzt', { konto: (await K.kontoKurz(targetId))?.username ?? String(targetId), durch });

  res.json({ success: true });
});

router.delete('/users/:id', requireAdmin, async (req, res: Antwort<'DELETE /api/v1/auth/users/:id'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  if (targetId !== nutzerId(req) && await K.kontoExistiert(targetId))
    await protokolliere(angemeldeteNutzerId(req), targetId, 'konto_geloescht');
  if (!await K.loescheKonto(targetId, nutzerId(req))) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden_oder_eigenes');
  // user_sessions hat keinen Fremdschlüssel auf users: Die offene Sitzung des
  // gelöschten Kontos bliebe ohne diesen Aufruf gültig.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#delete-users-id
  await revokeAllSessions(targetId);
  // Eigene Anleitungen und Gutschein-PDFs gehören zum Konto; liegen blieben sie ohne Besitzer.
  await loescheKontoDateien(targetId);
  // Der Token-Cache bediente gelöschte Zeilen sonst noch bis zu 60 Sekunden.
  leereTokenCache();
  // account_links verschwindet per CASCADE, ohne dass der Haushalt davon
  // erfährt; sonst bliebe das Unterkonto bis zu fünf Minuten im Blickfeld.
  meldeHaushaltsaenderung();
  res.json({ success: true });
});

// Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
router.delete('/users/:id/zweiter-faktor', requireAdmin, async (req, res: Antwort<'DELETE /api/v1/auth/users/:id/zweiter-faktor'>) => {
  const id = parseInt(pfadParam(req, 'id'));
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (id === nutzerId(req)) return sendeFehler(req, res, 400, 'eigener_zweiter_faktor');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  await zf.schalteAb(id);
  await protokolliere(angemeldeteNutzerId(req), id, 'zweiter_faktor_entfernt');
  const durch = nutzerName(req) ?? '';
  hinweisNebenher(id, 'zweiter_faktor_entfernt', undefined, { durch });
  verwalterHinweisNebenher('verwaltung_faktor_entfernt', { konto: (await K.kontoKurz(id))?.username ?? String(id), durch });
  res.json({ success: true });
});

router.use(fehlerAntwort);

export = router;
