import { ERRORS, responseLanguage, errorText, type ErrorCode } from '../../src/infra/errorTexts';
import { viewOf, guardFor } from './middleware';
import { singleValue } from '../../src/infra/validate';
import { pageFrom } from '../../src/infra/page';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

/** Price errors come with a code from the valuation; the text follows the request's language, not the server's. */
function translated<T extends { error?: unknown; error_code?: unknown }>(
  rows: T[],
  req: Parameters<typeof responseLanguage>[0],
): T[] {
  const language = responseLanguage(req);
  return rows.map(z =>
    typeof z.error_code === 'string' && z.error_code in ERRORS
      ? { ...z, error: errorText(z.error_code as ErrorCode, language) }
      : z,
  );
}

export function buildFinanceRouter(d: Pick<Services, 'account' | 'finances'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('GET /api/v2/finance/valuation', requireToken, async req => {
    const data = await d.finances.valueSets(req.apiUser.user_id, viewOf(req));
    // No `rate_limit` in the response: it cost three queries per call and
    // is shown in the monitoring.
    const { entries: sets, ...page } = pageFrom(translated(data.sets, req), req.queryArgs);
    return { total_value: data.totals.qty_avg, value_total: Number(data.totals.qty_avg), ...data, sets, ...page };
  });

  router.endpoint('GET /api/v2/finance/parts-valuation', requireToken, async req => {
    const data = await d.finances.valueParts(req.apiUser.user_id, viewOf(req));
    const { entries: parts, ...page } = pageFrom(translated(data.parts, req), req.queryArgs);
    return { ...data, parts, ...page };
  });

  router.endpoint('GET /api/v2/finance/minifigs-valuation', requireToken, async req => {
    const data = await d.finances.valueMinifigs(req.apiUser.user_id, viewOf(req));
    const { entries: figs, ...page } = pageFrom(translated(data.figs, req), req.queryArgs);
    return { ...data, figs, ...page };
  });

  router.endpoint('GET /api/v2/finance/pnl', requireToken, async req => {
    const data = await d.finances.gainAndLoss(req.apiUser.user_id, viewOf(req));
    const { entries: sets, ...page } = pageFrom(data.sets, req.queryArgs);
    return { ...data, sets, ...page };
  });

  router.endpoint('GET /api/v2/finance/portfolio-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // einzelwert(): ?period=a&period=b arrives as an array and would otherwise go
    // back into the response unchanged.
    const period = singleValue(req.queryArgs.period, 'week');
    return { ...(await d.finances.portfolioHistory(uid, viewOf(req), period)) };
  });
  return router;
}
