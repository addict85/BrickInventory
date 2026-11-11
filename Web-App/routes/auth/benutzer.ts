/** Benutzerverwaltung für Verwalter: Jede Änderung verlangt Passwort und
 * zweiten Faktor des Verwalters und steht im Protokoll. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { nutzerId, angemeldeteNutzerId, bestaetigeMitFaktor, nutzerName } from '../../src/konto/http/anmeldung';
import { passwortMangel } from '../../src/infra/passwortRegel';
import { requireApiAdmin } from '../api_v1/middleware';
import { alsDoppelt } from '../../src/infra/fehlerTexte';
import { vertragsRouter, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import { USERNAME_RE, kontoEntfernen, hinweisNebenher, verwalterHinweisNebenher, kontoBereich, kontenListe, legeKontoAn, setzeVerwalterRolle, LETZTER_VERWALTER, setzeAktiv, setzeFremdesPasswort, schalteAb } from '../../src/konto';

const router = vertragsRouter();
const requireAdmin = requireApiAdmin;

router.get('/users', requireAdmin, async (_req, res: Antwort<'GET /api/v1/auth/users'>) => {
  const users = await kontenListe();
  res.json({ success: true, users });
});

router.post('/users', requireAdmin, async (req: OffeneAnfrage<'POST /api/v1/auth/users'>, res: Antwort<'POST /api/v1/auth/users'>) => {
  const { username, password } = req.eingabe;
  if (!username || !password) return sendeFehler(req, res, 400, 'benutzername_passwort');
  if (!USERNAME_RE.test(String(username)))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  const mangel = passwortMangel(password, username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  // Streng: Die Zeichenkette "false" ist in JavaScript wahr und legte einen
  // Verwalter an.
  const alsVerwalter = req.eingabe.is_admin ?? req.eingabe.isAdmin ?? false;
  // Passwort bestätigen und protokollieren — eine erbeutete Sitzung soll keinen
  // Verwalter anlegen.
  const verwalter = angemeldeteNutzerId(req);
  if (!await bestaetigeMitFaktor(req, res, verwalter, req.eingabe.admin_password)) return;
  // Wie bei der Registrierung auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
  if (await kontoBereich().konten.nameVergeben(username, 0)) return sendeFehler(req, res, 409, 'benutzername_vergeben');
  const neu = await legeKontoAn(username, password, alsVerwalter).catch(alsDoppelt('benutzername_vergeben'));
  if (neu === null) return sendeFehler(req, res, 409, 'benutzername_vergeben');
  await kontoBereich().protokoll.protokolliere(verwalter, neu, 'konto_angelegt');
  if (alsVerwalter) await kontoBereich().protokoll.protokolliere(verwalter, neu, 'verwalter_ernannt');
  if (alsVerwalter) verwalterHinweisNebenher('verwalter_ernannt', { konto: String(username), durch: nutzerName(req) ?? '' });
  res.json({ success: true });
});

router.put('/users/:id/admin', requireAdmin, async (req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/admin'>, res: Antwort<'PUT /api/v1/auth/users/:id/admin'>) => {
  const targetId = req.pfad.id;
  // Streng: "false" ist in JavaScript wahr und entzöge sonst keine Rechte.
  const soll = req.eingabe.is_admin;
  if (targetId === nutzerId(req) && !soll)
    return sendeFehler(req, res, 400, 'eigene_adminrolle');
  if (!await kontoBereich().konten.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password)) return;
  const r = await setzeVerwalterRolle(targetId, soll);
  if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (r === LETZTER_VERWALTER) return sendeFehler(req, res, 409, 'verwalter_muss_bleiben');
  if (r.geaendert) await kontoBereich().protokoll.protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');
  if (r.geaendert && soll) verwalterHinweisNebenher('verwalter_ernannt',
    { konto: (await kontoBereich().konten.kontoKurz(targetId))?.username ?? String(targetId), durch: nutzerName(req) ?? '' });

  // Sitzungen enden, weil istVerwalter() zuerst das nie nachgeführte
  // `req.session.isAdmin` fragt; ein Entzug wirkte sonst im offenen Fenster nicht.
  res.json({ success: true });
});

router.put('/users/:id/aktiv', requireAdmin, async (req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/aktiv'>, res: Antwort<'PUT /api/v1/auth/users/:id/aktiv'>) => {
  const targetId = req.pfad.id;
  const soll = req.eingabe.is_active;
  if (!Number.isInteger(targetId)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (targetId === nutzerId(req)) return sendeFehler(req, res, 400, 'eigenes_konto_deaktivieren');
  if (!await kontoBereich().konten.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password)) return;
  const r = await setzeAktiv(targetId, soll);
  if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (r === LETZTER_VERWALTER) return sendeFehler(req, res, 409, 'verwalter_muss_bleiben');
  if (r.geaendert) await kontoBereich().protokoll.protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
  res.json({ success: true, is_active: soll });
});

// Für Registrierungen, deren Bestätigungsmail nie ankam: Der Verwalter bürgt für die Adresse.
router.put('/users/:id/freischalten', requireAdmin, async (req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/freischalten'>, res: Antwort<'PUT /api/v1/auth/users/:id/freischalten'>) => {
  const targetId = req.pfad.id;
  if (!Number.isInteger(targetId) || !await kontoBereich().konten.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password)) return;
  const r = await kontoBereich().konten.schalteRegistrierungFrei(targetId);
  if (r !== 'ok') return sendeFehler(req, res, 409, r === 'vergeben' ? 'email_vergeben' : 'konto_nicht_wartend');
  await kontoBereich().protokoll.protokolliere(angemeldeteNutzerId(req), targetId, 'konto_freigeschaltet');
  res.json({ success: true });
});

/** Ohne aktuelles Passwort des Ziels, aber mit dem des Verwalters. */
router.put('/users/:id/password', requireAdmin, async (req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/password'>, res: Antwort<'PUT /api/v1/auth/users/:id/password'>) => {
  const { password } = req.eingabe || {};
  const targetId = req.pfad.id;
  if (!targetId || targetId === nutzerId(req))
    return sendeFehler(req, res, 400, 'eigenes_konto_passwort');
  const mangel = passwortMangel(password, (await kontoBereich().konten.kontoKurz(targetId))?.username);
  if (mangel) return sendeFehler(req, res, 400, mangel);

  // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
  // eine offene Verwaltersitzung allein genügt dafür nicht.
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password)) return;
  if (!await setzeFremdesPasswort(targetId, password ?? '')) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  await kontoBereich().protokoll.protokolliere(angemeldeteNutzerId(req), targetId, 'passwort_gesetzt');
  // Wie beim entfernten Faktor: Eine Übernahme durch eine erbeutete Verwaltersitzung bliebe sonst unbemerkt.
  const durch = nutzerName(req) ?? '';
  hinweisNebenher(targetId, 'passwort_durch_verwalter', undefined, { durch });
  verwalterHinweisNebenher('verwaltung_passwort_gesetzt', { konto: (await kontoBereich().konten.kontoKurz(targetId))?.username ?? String(targetId), durch });

  res.json({ success: true });
});

router.delete('/users/:id', requireAdmin, async (req: OffeneAnfrage<'DELETE /api/v1/auth/users/:id'>, res: Antwort<'DELETE /api/v1/auth/users/:id'>) => {
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password)) return;
  const r = await kontoEntfernen(req.pfad.id, angemeldeteNutzerId(req));
  if (r === LETZTER_VERWALTER) return sendeFehler(req, res, 409, 'verwalter_muss_bleiben');
  if (r !== 'entfernt') return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden_oder_eigenes');
  res.json({ success: true });
});

// Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
router.delete('/users/:id/zweiter-faktor', requireAdmin, async (req: OffeneAnfrage<'DELETE /api/v1/auth/users/:id/zweiter-faktor'>, res: Antwort<'DELETE /api/v1/auth/users/:id/zweiter-faktor'>) => {
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (id === nutzerId(req)) return sendeFehler(req, res, 400, 'eigener_zweiter_faktor');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password)) return;
  await schalteAb(id);
  await kontoBereich().protokoll.protokolliere(angemeldeteNutzerId(req), id, 'zweiter_faktor_entfernt');
  const durch = nutzerName(req) ?? '';
  hinweisNebenher(id, 'zweiter_faktor_entfernt', undefined, { durch });
  verwalterHinweisNebenher('verwaltung_faktor_entfernt', { konto: (await kontoBereich().konten.kontoKurz(id))?.username ?? String(id), durch });
  res.json({ success: true });
});

router.use(fehlerAntwort);

export = router;
