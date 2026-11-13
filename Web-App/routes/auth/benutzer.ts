/** Benutzerverwaltung für Verwalter: Jede Änderung verlangt Passwort und
 * zweiten Faktor des Verwalters und steht im Protokoll. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { nutzerId, angemeldeteNutzerId, bestaetigeMitFaktor, nutzerName } from '../../src/konto/http/anmeldung';
import { passwortMangel } from '../../src/infra/passwortRegel';
import { requireApiAdminUeberKonten } from '../api_v1/middleware';
import { vertragsRouter, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import {
  USERNAME_RE,
  kontoEntfernen,
  hinweisNebenher,
  verwalterHinweisNebenher,
  kontenListe,
  gibtKonto,
  kontoKurzVon,
  kontoAnzeigeName,
  legeKontoAn,
  LETZTER_VERWALTER,
  setzeFremdesPasswort,
  aktivSetzen,
  registrierungFreischalten,
  verwalterRolleSetzen,
  zweitenFaktorEntfernen,
} from '../../src/konto';

const router = vertragsRouter();
const requireAdmin = requireApiAdminUeberKonten;

router.get('/users', requireAdmin, async (_req, res: Antwort<'GET /api/v1/auth/users'>) => {
  const users = await kontenListe();
  res.json({ success: true, users });
});

router.post(
  '/users',
  requireAdmin,
  async (req: OffeneAnfrage<'POST /api/v1/auth/users'>, res: Antwort<'POST /api/v1/auth/users'>) => {
    const { username, password } = req.eingabe;
    if (!username || !password) return sendeFehler(req, res, 400, 'benutzername_passwort');
    if (!USERNAME_RE.test(String(username))) return sendeFehler(req, res, 400, 'benutzername_ungueltig');
    const mangel = passwortMangel(password, username);
    if (mangel) return sendeFehler(req, res, 400, mangel);
    // Streng: Die Zeichenkette "false" ist in JavaScript wahr und legte einen
    // Verwalter an.
    const alsVerwalter = req.eingabe.is_admin ?? req.eingabe.isAdmin ?? false;
    // Passwort bestätigen und protokollieren — eine erbeutete Sitzung soll keinen
    // Verwalter anlegen.
    const verwalter = angemeldeteNutzerId(req);
    if (!(await bestaetigeMitFaktor(req, res, verwalter, req.eingabe.admin_password))) return;
    if ((await legeKontoAn(verwalter, username, password, alsVerwalter)) === null)
      return sendeFehler(req, res, 409, 'benutzername_vergeben');
    if (alsVerwalter)
      verwalterHinweisNebenher('verwalter_ernannt', { konto: String(username), durch: nutzerName(req) ?? '' });
    res.json({ success: true });
  },
);

router.put(
  '/users/:id/admin',
  requireAdmin,
  async (req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/admin'>, res: Antwort<'PUT /api/v1/auth/users/:id/admin'>) => {
    const targetId = req.pfad.id;
    // Streng: "false" ist in JavaScript wahr und entzöge sonst keine Rechte.
    const soll = req.eingabe.is_admin;
    if (targetId === nutzerId(req) && !soll) return sendeFehler(req, res, 400, 'eigene_adminrolle');
    if (!(await gibtKonto(targetId))) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    if (!(await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await verwalterRolleSetzen(angemeldeteNutzerId(req), targetId, soll);
    if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    if (r === LETZTER_VERWALTER) return sendeFehler(req, res, 409, 'verwalter_muss_bleiben');
    if (r.geaendert && soll)
      verwalterHinweisNebenher('verwalter_ernannt', {
        konto: await kontoAnzeigeName(targetId),
        durch: nutzerName(req) ?? '',
      });

    // Sitzungen enden, weil istVerwalter() zuerst das nie nachgeführte
    // `req.session.isAdmin` fragt; ein Entzug wirkte sonst im offenen Fenster nicht.
    res.json({ success: true });
  },
);

router.put(
  '/users/:id/aktiv',
  requireAdmin,
  async (req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/aktiv'>, res: Antwort<'PUT /api/v1/auth/users/:id/aktiv'>) => {
    const targetId = req.pfad.id;
    const soll = req.eingabe.is_active;
    if (!Number.isInteger(targetId)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (targetId === nutzerId(req)) return sendeFehler(req, res, 400, 'eigenes_konto_deaktivieren');
    if (!(await gibtKonto(targetId))) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    if (!(await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await aktivSetzen(angemeldeteNutzerId(req), targetId, soll);
    if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    if (r === LETZTER_VERWALTER) return sendeFehler(req, res, 409, 'verwalter_muss_bleiben');
    res.json({ success: true, is_active: soll });
  },
);

// Für Registrierungen, deren Bestätigungsmail nie ankam: Der Verwalter bürgt für die Adresse.
router.put(
  '/users/:id/freischalten',
  requireAdmin,
  async (
    req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/freischalten'>,
    res: Antwort<'PUT /api/v1/auth/users/:id/freischalten'>,
  ) => {
    const targetId = req.pfad.id;
    if (!Number.isInteger(targetId) || !(await gibtKonto(targetId)))
      return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    if (!(await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await registrierungFreischalten(angemeldeteNutzerId(req), targetId);
    if (r !== 'ok') return sendeFehler(req, res, 409, r === 'vergeben' ? 'email_vergeben' : 'konto_nicht_wartend');
    res.json({ success: true });
  },
);

/** Ohne aktuelles Passwort des Ziels, aber mit dem des Verwalters. */
router.put(
  '/users/:id/password',
  requireAdmin,
  async (
    req: OffeneAnfrage<'PUT /api/v1/auth/users/:id/password'>,
    res: Antwort<'PUT /api/v1/auth/users/:id/password'>,
  ) => {
    const { password } = req.eingabe || {};
    const targetId = req.pfad.id;
    if (!targetId || targetId === nutzerId(req)) return sendeFehler(req, res, 400, 'eigenes_konto_passwort');
    const mangel = passwortMangel(password, (await kontoKurzVon(targetId))?.username);
    if (mangel) return sendeFehler(req, res, 400, mangel);

    // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
    // eine offene Verwaltersitzung allein genügt dafür nicht.
    if (!(await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    if (!(await setzeFremdesPasswort(targetId, password ?? '', angemeldeteNutzerId(req))))
      return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    // Wie beim entfernten Faktor: Eine Übernahme durch eine erbeutete Verwaltersitzung bliebe sonst unbemerkt.
    const durch = nutzerName(req) ?? '';
    hinweisNebenher(targetId, 'passwort_durch_verwalter', undefined, { durch });
    verwalterHinweisNebenher('verwaltung_passwort_gesetzt', { konto: await kontoAnzeigeName(targetId), durch });

    res.json({ success: true });
  },
);

router.delete(
  '/users/:id',
  requireAdmin,
  async (req: OffeneAnfrage<'DELETE /api/v1/auth/users/:id'>, res: Antwort<'DELETE /api/v1/auth/users/:id'>) => {
    if (!(await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await kontoEntfernen(req.pfad.id, angemeldeteNutzerId(req));
    if (r === LETZTER_VERWALTER) return sendeFehler(req, res, 409, 'verwalter_muss_bleiben');
    if (r !== 'entfernt') return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden_oder_eigenes');
    res.json({ success: true });
  },
);

// Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
router.delete(
  '/users/:id/zweiter-faktor',
  requireAdmin,
  async (
    req: OffeneAnfrage<'DELETE /api/v1/auth/users/:id/zweiter-faktor'>,
    res: Antwort<'DELETE /api/v1/auth/users/:id/zweiter-faktor'>,
  ) => {
    const id = req.pfad.id;
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (id === nutzerId(req)) return sendeFehler(req, res, 400, 'eigener_zweiter_faktor');
    if (!(await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    await zweitenFaktorEntfernen(angemeldeteNutzerId(req), id);
    const durch = nutzerName(req) ?? '';
    hinweisNebenher(id, 'zweiter_faktor_entfernt', undefined, { durch });
    verwalterHinweisNebenher('verwaltung_faktor_entfernt', { konto: await kontoAnzeigeName(id), durch });
    res.json({ success: true });
  },
);

router.use(fehlerAntwort);

export = router;
