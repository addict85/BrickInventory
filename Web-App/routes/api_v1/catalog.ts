import { fehlerAntwort } from '../../src/infra/httpError';
import { requireToken } from './middleware';
import { resolveMany } from '../../src/katalog/bricklinkLink';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { katalogMeta, jahrVerteilung, katalogSeite, katalogSet } from '../../src/katalog/dienst';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';

const router = vertragsRouter();

const zahl = (v: unknown) => parseInt(String(v || '')) || null;

router.get('/catalog/meta', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/catalog/meta'>) => {
  res.json({ success: true, ...await katalogMeta() }); 
});

router.get('/catalog/year-verteilung', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/catalog/year-verteilung'>) => {
  const years = await jahrVerteilung({ q: String(req.query.q || '').trim(), themeId: zahl(req.query.theme_id) },
    String(req.query.sort || '') !== 'year_asc');
  res.json({ success: true, years });
});

router.get('/catalog/sets', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/catalog/sets'>) => {
  const page  = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '60')) || 60));
  const seite = await katalogSeite(req.apiUser.user_id, {
    q: String(req.query.q || '').trim(), themeId: zahl(req.query.theme_id),
    yearFrom: zahl(req.query.year_from), yearTo: zahl(req.query.year_to) }, req.query.sort, page, limit);
  res.json({ success: true, ...seite });
});

router.get('/catalog/sets/:setNumber', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/catalog/sets/:setNumber'>) => {
  const set = await katalogSet(req.apiUser.user_id, String(req.params.setNumber || ''));
  if (!set) { sendeFehler(req, res, 404, 'set_nicht_im_katalog'); return; }
  res.json({ success: true, set });
});

// Links für eine ganze Katalogseite aus einer Abfrage, ohne BrickLink-Aufruf.
router.get('/catalog/bricklink', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/catalog/bricklink'>) => {
  const raw = String(req.query.sets || '').trim();
  if (!raw) { res.json({ success: true, links: {} }); return; }
  const map = await resolveMany(raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 500));
  res.json({ success: true, links: Object.fromEntries(map) });
});

router.use(fehlerAntwort);

export = router;
