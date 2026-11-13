import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { requireToken } from './middleware';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

export function baueCatalogRouter(d: Dienste) {
  const router = vertragsRouter();

  router.get('/catalog/meta', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/catalog/meta'>) => {
    res.json({ success: true, ...(await d.katalog.katalogMeta()) });
  });

  router.get(
    '/catalog/year-verteilung',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/catalog/year-verteilung'>,
      res: Antwort<'GET /api/v1/catalog/year-verteilung'>,
    ) => {
      const q = req.abfrage;
      const years = await d.katalog.jahrVerteilung(
        { q: (q.q ?? '').trim(), themeId: q.theme_id || null },
        q.sort !== 'year_asc',
      );
      res.json({ success: true, years });
    },
  );

  router.get(
    '/catalog/sets',
    requireToken,
    async (req: Anfrage<'GET /api/v1/catalog/sets'>, res: Antwort<'GET /api/v1/catalog/sets'>) => {
      const q = req.abfrage;
      const page = Math.max(1, q.page ?? 1);
      const limit = Math.min(200, Math.max(1, q.page_size ?? q.limit ?? 60));
      const seite = await d.katalog.katalogSeite(
        req.apiUser.user_id,
        {
          q: (q.q ?? '').trim(),
          themeId: q.theme_id || null,
          yearFrom: q.year_from || null,
          yearTo: q.year_to || null,
        },
        q.sort,
        page,
        limit,
      );
      res.json({ success: true, ...seite });
    },
  );

  router.get(
    '/catalog/sets/:setNumber',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/catalog/sets/:setNumber'>,
      res: Antwort<'GET /api/v1/catalog/sets/:setNumber'>,
    ) => {
      const set = await d.katalog.katalogSet(req.apiUser.user_id, req.pfad.setNumber);
      if (!set) {
        sendeFehler(
          req,
          res,
          404,
          (await d.katalog.katalogGeladen()) ? 'set_nicht_im_katalog' : 'katalog_nicht_geladen',
        );
        return;
      }
      res.json({ success: true, set });
    },
  );

  // Links für eine ganze Katalogseite aus einer Abfrage, ohne BrickLink-Aufruf.
  router.get(
    '/catalog/bricklink',
    requireToken,
    async (req: Anfrage<'GET /api/v1/catalog/bricklink'>, res: Antwort<'GET /api/v1/catalog/bricklink'>) => {
      const raw = (req.abfrage.sets ?? '').trim();
      if (!raw) {
        res.json({ success: true, links: {} });
        return;
      }
      const map = await d.katalog.resolveMany(
        raw
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 500),
      );
      res.json({ success: true, links: Object.fromEntries(map) });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
