import { fehlerAntwort } from '../../src/http/httpAntwort';
import { FEHLER, antwortSprache, fehlerText, type FehlerCode } from '../../src/infra/fehlerTexte';
import { sichtVon, waechterFuer } from './middleware';
import { einzelwert } from '../../src/infra/validate';
import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

/** Preisfehler kommen mit Code aus der Bewertung; der Text folgt der Sprache der Anfrage, nicht dem Server. */
function uebersetzt<T extends { error?: unknown; error_code?: unknown }>(
  zeilen: T[],
  req: Parameters<typeof antwortSprache>[0],
): T[] {
  const sprache = antwortSprache(req);
  return zeilen.map(z =>
    typeof z.error_code === 'string' && z.error_code in FEHLER
      ? { ...z, error: fehlerText(z.error_code as FehlerCode, sprache) }
      : z,
  );
}

export function baueFinanceRouter(d: Pick<Dienste, 'konto' | 'finanzen'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/finance/valuation', requireToken, async req => {
    const data = await d.finanzen.computeSetsValuation(req.apiUser.user_id, sichtVon(req));
    // Kein `rate_limit` in der Antwort: Er kostete drei Abfragen je Aufruf und
    // steht in der Überwachung.
    const { eintraege: sets, ...seite } = seiteAus(uebersetzt(data.sets, req), req.abfrage);
    return { total_value: data.totals.qty_avg, wert_gesamt: Number(data.totals.qty_avg), ...data, sets, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/parts-valuation', requireToken, async req => {
    const data = await d.finanzen.computePartsValuation(req.apiUser.user_id, sichtVon(req));
    const { eintraege: parts, ...seite } = seiteAus(uebersetzt(data.parts, req), req.abfrage);
    return { ...data, parts, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/minifigs-valuation', requireToken, async req => {
    const data = await d.finanzen.computeMinifigsValuation(req.apiUser.user_id, sichtVon(req));
    const { eintraege: figs, ...seite } = seiteAus(uebersetzt(data.figs, req), req.abfrage);
    return { ...data, figs, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/pnl', requireToken, async req => {
    const data = await d.finanzen.computePnl(req.apiUser.user_id, sichtVon(req));
    const { eintraege: sets, ...seite } = seiteAus(data.sets, req.abfrage);
    return { ...data, sets, ...seite };
  });

  router.endpunkt('GET /api/v1/finance/portfolio-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // einzelwert(): ?period=a&period=b kommt als Array an und ginge sonst
    // unverändert in die Antwort zurück.
    const period = einzelwert(req.abfrage.period, 'week');
    return { ...(await d.finanzen.getPortfolioHistory(uid, sichtVon(req), period)) };
  });

  router.use(fehlerAntwort);
  return router;
}
