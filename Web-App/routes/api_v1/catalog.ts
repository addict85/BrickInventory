import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { waechterFuer } from './middleware';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueCatalogRouter(d: Pick<Dienste, 'konto' | 'katalog'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/catalog/meta', requireToken, async _req => {
    return { ...(await d.katalog.katalogMeta()) };
  });

  router.endpunkt('GET /api/v1/catalog/year-verteilung', requireToken, async req => {
    const q = req.abfrage;
    const years = await d.katalog.jahrVerteilung(
      { q: (q.q ?? '').trim(), themeId: q.theme_id || null },
      q.sort !== 'year_asc',
    );
    return { years };
  });

  router.endpunkt('GET /api/v1/catalog/sets', requireToken, async req => {
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
    return { ...seite };
  });

  router.endpunkt('GET /api/v1/catalog/sets/:setNumber', requireToken, async (req, res) => {
    const set = await d.katalog.katalogSet(req.apiUser.user_id, req.pfad.setNumber);
    if (!set) {
      sendeFehler(req, res, 404, (await d.katalog.katalogGeladen()) ? 'set_nicht_im_katalog' : 'katalog_nicht_geladen');
      return;
    }
    return { set };
  });

  // Links für eine ganze Katalogseite aus einer Abfrage, ohne BrickLink-Aufruf.
  router.endpunkt('GET /api/v1/catalog/bricklink', requireToken, async req => {
    const raw = (req.abfrage.sets ?? '').trim();
    if (!raw) {
      return { links: {} };
    }
    const map = await d.katalog.resolveMany(
      raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 500),
    );
    return { links: Object.fromEntries(map) };
  });

  router.use(fehlerAntwort);
  return router;
}
