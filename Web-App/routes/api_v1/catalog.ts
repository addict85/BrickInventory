import { guardFor } from './middleware';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { notFound } from '../../src/infra/fehlerTexte';

export function buildCatalogRouter(d: Pick<Dienste, 'konto' | 'katalog'>) {
  const { requireToken } = guardFor(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/catalog/meta', requireToken, async _req => {
    return { ...(await d.katalog.catalogMeta()) };
  });

  router.endpunkt('GET /api/v1/catalog/year-verteilung', requireToken, async req => {
    const q = req.abfrage;
    const years = await d.katalog.yearDistribution(
      { q: (q.q ?? '').trim(), themeId: q.theme_id || null },
      q.sort !== 'year_asc',
    );
    return { years };
  });

  router.endpunkt('GET /api/v1/catalog/sets', requireToken, async req => {
    const q = req.abfrage;
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.page_size ?? q.limit ?? 60));
    const seite = await d.katalog.catalogPage(
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

  router.endpunkt('GET /api/v1/catalog/sets/:setNumber', requireToken, async req => {
    const set = await d.katalog.catalogSet(req.apiUser.user_id, req.pfad.setNumber);
    if (!set) notFound((await d.katalog.catalogLoaded()) ? 'set_nicht_im_katalog' : 'katalog_nicht_geladen');
    return { set };
  });

  // Links für eine ganze Katalogseite aus einer Abfrage, ohne BrickLink-Aufruf.
  router.endpunkt('GET /api/v1/catalog/bricklink', requireToken, async req => {
    const raw = (req.abfrage.sets ?? '').trim();
    if (!raw) {
      return { links: {} };
    }
    const map = await d.katalog.resolveBlLinks(
      raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 500),
    );
    return { links: Object.fromEntries(map) };
  });
  return router;
}
