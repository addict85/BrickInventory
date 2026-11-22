import { guardFor } from './middleware';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { notFound } from '../../src/infra/errorTexts';

export function buildCatalogRouter(d: Pick<Services, 'account' | 'catalog'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('GET /api/v2/catalog/meta', requireToken, async _req => {
    return { ...(await d.catalog.catalogMeta()) };
  });

  router.endpoint('GET /api/v2/catalog/year-distribution', requireToken, async req => {
    const q = req.queryArgs;
    const years = await d.catalog.yearDistribution(
      { q: (q.q ?? '').trim(), themeId: q.theme_id || null },
      q.sort !== 'year_asc',
    );
    return { years };
  });

  router.endpoint('GET /api/v2/catalog/sets', requireToken, async req => {
    const q = req.queryArgs;
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.page_size ?? q.limit ?? 60));
    const pageNo = await d.catalog.catalogPage(
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
    return { ...pageNo };
  });

  router.endpoint('GET /api/v2/catalog/sets/:setNumber', requireToken, async req => {
    const set = await d.catalog.catalogSet(req.apiUser.user_id, req.pathArgs.setNumber);
    if (!set) notFound((await d.catalog.catalogLoaded()) ? 'set_not_in_catalog' : 'catalog_not_loaded');
    return { set };
  });

  // Links for a whole catalog page from one query, without a BrickLink call.
  router.endpoint('GET /api/v2/catalog/bricklink', requireToken, async req => {
    const raw = (req.queryArgs.sets ?? '').trim();
    if (!raw) {
      return { links: {} };
    }
    const map = await d.catalog.resolveBlLinks(
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
