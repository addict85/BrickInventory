import { FEHLER, responseLanguage, errorText, type ErrorCode } from '../../src/infra/errorTexts';
import { viewOf, guardFor } from './middleware';
import { singleValue } from '../../src/infra/validate';
import { pageFrom } from '../../src/infra/page';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';

/** Preisfehler kommen mit Code aus der Bewertung; der Text folgt der Sprache der Anfrage, nicht dem Server. */
function uebersetzt<T extends { error?: unknown; error_code?: unknown }>(
  zeilen: T[],
  req: Parameters<typeof responseLanguage>[0],
): T[] {
  const sprache = responseLanguage(req);
  return zeilen.map(z =>
    typeof z.error_code === 'string' && z.error_code in FEHLER
      ? { ...z, error: errorText(z.error_code as ErrorCode, sprache) }
      : z,
  );
}

export function buildFinanceRouter(d: Pick<Dienste, 'account' | 'finances'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/finance/valuation', requireToken, async req => {
    const data = await d.finances.valueSets(req.apiUser.user_id, viewOf(req));
    // Kein `rate_limit` in der Antwort: Er kostete drei Abfragen je Aufruf und
    // steht in der Überwachung.
    const { eintraege: sets, ...seite } = pageFrom(uebersetzt(data.sets, req), req.abfrage);
    return { total_value: data.totals.qty_avg, wert_gesamt: Number(data.totals.qty_avg), ...data, sets, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/parts-valuation', requireToken, async req => {
    const data = await d.finances.valueParts(req.apiUser.user_id, viewOf(req));
    const { eintraege: parts, ...seite } = pageFrom(uebersetzt(data.parts, req), req.abfrage);
    return { ...data, parts, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/minifigs-valuation', requireToken, async req => {
    const data = await d.finances.valueMinifigs(req.apiUser.user_id, viewOf(req));
    const { eintraege: figs, ...seite } = pageFrom(uebersetzt(data.figs, req), req.abfrage);
    return { ...data, figs, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/pnl', requireToken, async req => {
    const data = await d.finances.gainAndLoss(req.apiUser.user_id, viewOf(req));
    const { eintraege: sets, ...seite } = pageFrom(data.sets, req.abfrage);
    return { ...data, sets, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/portfolio-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // einzelwert(): ?period=a&period=b kommt als Array an und ginge sonst
    // unverändert in die Antwort zurück.
    const period = singleValue(req.abfrage.period, 'week');
    return { ...(await d.finances.portfolioVerlauf(uid, viewOf(req), period)) };
  });
  return router;
}
