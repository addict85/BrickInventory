import { getSetValue } from './setValue';
import { preisFuerSetHolen } from './priceRun';
import {
  DEFAULT_PRICE_CONDITION,
  fetchPartPrice,
  fetchMinifigPrice,
  loadBlNumbersBefore,
  priceOrNone,
  resolveBlPartNumber,
  resolveBlColorId,
} from './calculation/prices';
import { reportError, logAndContinue } from '../infra/fehler';
import { marketPriceFrom } from '../katalog';
import { KEINE_FARBE, zustand } from '../infra/validate';
import type { FinancesContext } from './context';

// Ein Blatt ohne Rückbezug, damit die Aufrufer echt importieren statt spät mit require().
export async function aktuellerMarktpreis(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  condition: string | null = null,
) {
  const currency = String(await k.einstellungen.userValue(userId, 'currency', 'EUR'));
  // Parameter → Nutzer → global → 'N'.
  const effectiveCond = condition || (await k.einstellungen.userDefaultCondition(userId));
  // condition als Hinweis: Beim Anlegen gibt es noch keine Erfassung, aus der
  // der Preislauf den Zustand ablesen könnte.
  await preisFuerSetHolen(k, setNumber, userId, condition).catch(logAndContinue('marktpreis:preisFuerSetHolen'));

  // Ein ausdrücklich angefragter Zustand gilt genau so: Beim Anlegen gibt es
  // noch keine Erfassung, aus der getSetValue() ihn ableiten könnte.
  if (!condition) {
    // Ohne ausdrücklichen Wunsch: Bewertung je Erfassung nach deren Zustand.
    const v = await getSetValue(k, userId, setNumber, currency);
    if (v.unit_price !== null) return v.unit_price;
  }

  // Angefragter Zustand zuerst; der andere nur, wenn dort kein Preis steht.
  const cached = await k.marktpreise.setPriceFromCache(setNumber, effectiveCond, currency);
  return cached ? Number(cached.marktpreis) : null;
}

// Marktpreise für Sets, Teile und Figuren an einer Stelle, damit die Zustandsregel
// nicht je Art auseinanderläuft.

/** 'U' sobald eine Erfassung gebraucht ist; ohne Erfassung der Standard. */
export async function partState(k: FinancesContext, userId: number, partNumber: string, colorId: number) {
  try {
    const row = await k.marktpreise.partEntryState(userId, partNumber, colorId);
    if (row && parseInt(row.cnt, 10) > 0) return Number(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) {
    reportError('teile:zustand-ermitteln', e);
  }
  return k.einstellungen.userDefaultCondition(userId);
}

/** Nur aus dem Cache, ohne Abruf: Die Liste soll nicht auf BrickLink warten. */
export async function marketPricesFromCacheForMinifigs(
  kx: FinancesContext,
  figuren: Array<{ fig_number?: string | null; bl_fig_number?: string | null; condition?: string | null }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!figuren.length) return treffer;

  const [currency, ttlRaw] = await Promise.all([
    kx.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    kx.einstellungen.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRaw), 10));

  // Beide Schreibweisen: fetchMinifigPrice() legt unter der BL-Nummer ab, die
  // Schätzung unter der RB-Nummer.
  const schluessel = [...new Set(figuren.flatMap(f => [f.bl_fig_number, f.fig_number].filter(Boolean).map(String)))];
  if (!schluessel.length) return treffer;

  // Ohne Fang: Die Liste fasst den Fehler als `degradiert` (Abstriche) und zeigt sie ohne Preis.
  const zeilen = await kx.marktpreise.minifigsPricesFromCache(schluessel, String(currency), ttl);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = marketPriceFrom(z);
    if (wert !== null) cache.set(`${z.fig_number}|${z.condition}`, wert);
  }

  for (const f of figuren) {
    const nummer = String(f.fig_number ?? '');
    if (!nummer) continue;
    const zst = zustand(f.condition);
    const anders = zst === 'N' ? 'U' : 'N';
    // Reihenfolge wie in der Bewertung; BrickLink führt zu vielen älteren Figuren
    // nur einen der beiden Zustände.
    for (const k of [f.bl_fig_number, f.fig_number].filter(Boolean).map(String))
      for (const c of [zst, anders]) {
        const wert = cache.get(`${k}|${c}`);
        if (wert != null) {
          treffer.set(nummer, wert);
          break;
        }
      }
    if (treffer.has(nummer)) continue;
  }
  return treffer;
}

// Der Teile-Cache ist nach BrickLink-Nummer und -Farbe verschlüsselt; beides wird vorher übersetzt.
export async function marketPricesFromCacheForParts(
  k: FinancesContext,
  teile: Array<{
    part_number?: string | null;
    bl_part_number?: string | null;
    color_id?: number | null;
    condition?: string | null;
  }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!teile.length) return treffer;

  const [currency, ttlRaw] = await Promise.all([
    k.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    k.einstellungen.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRaw), 10));

  await loadBlNumbersBefore(
    k,
    teile.map(t => String(t.bl_part_number || t.part_number || '')),
  );

  // Die Schlüssel, unter denen fetchPartPrice geschrieben hätte.
  const resolution = new Map<string, { nummer: string; farbe: number }>();
  for (const t of teile) {
    const roh = String(t.bl_part_number || t.part_number || '');
    if (!roh) continue;
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    if (resolution.has(schluessel)) continue;
    resolution.set(schluessel, {
      nummer: await resolveBlPartNumber(k, roh),
      farbe: Number(await resolveBlColorId(k, Number(t.color_id ?? KEINE_FARBE))) || 0,
    });
  }

  const nummern = [...new Set([...resolution.values()].map(a => a.nummer))];
  if (!nummern.length) return treffer;
  const zeilen = await k.marktpreise.partsPricesFromCache(nummern, String(currency), ttl);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = marketPriceFrom(z);
    if (wert !== null) cache.set(`${z.part_number}|${z.color_id}|${z.condition}`, wert);
  }

  for (const t of teile) {
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    const a = resolution.get(schluessel);
    if (!a) continue;
    const zst = zustand(t.condition);
    for (const c of [zst, zst === 'N' ? 'U' : 'N']) {
      const wert = cache.get(`${a.nummer}|${a.farbe}|${c}`);
      if (wert != null) {
        treffer.set(schluessel, wert);
        break;
      }
    }
  }
  return treffer;
}

/** Mit Herkunft für die eine Stelle, die sie zeigt; alle anderen nehmen die Zahl. */
export async function marketPriceWithOrigin(
  k: FinancesContext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
  const ttlHours = (await k.einstellungen.globalValue('price_cache_ttl', '24')) || '24';
  const effCond = condition || (await partState(k, userId, partNumber, colorId));
  const priceData = await priceOrNone(
    fetchPartPrice(k, partNumber, colorId, effCond, currency, ttlHours, null, userId),
  );
  const price = marketPriceFrom(priceData);
  if (price === null) return { preis: null, fromState: null };
  // Der Rückfall auf den anderen Zustand wird übernommen, aber benannt: Gar
  // kein Preis war schlechter als ein gekennzeichneter.
  return {
    preis: price,
    fromState: priceData?.is_fallback ? priceData.condition_used || null : null,
  };
}

export async function currentPartMarketPrice(
  k: FinancesContext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  return (await marketPriceWithOrigin(k, partNumber, colorId, userId, condition)).preis;
}

export async function estimateFigPriceFromParts(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
) {
  return (await estimateMinifigsPrice(k, figNumber, userId, condition))?.preis ?? null;
}

/** Die Abdeckung (Anteil der Teile mit Preis) sagt, wie belastbar die Zahl ist. */
export async function estimateMinifigsPrice(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
): Promise<{ preis: number; abdeckung: number | null } | null> {
  try {
    const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
    const cond0 = zustand(condition, DEFAULT_PRICE_CONDITION);

    // Erst im Cache nachsehen: Sonst kostete jede Figur je Teil einen Abruf.
    const ttl = Math.max(1, parseInt(await k.einstellungen.globalValue('price_cache_ttl', '24'), 10));
    const cached = await k.marktpreise.estimatedMinifigsPrice(figNumber, cond0, currency, ttl);
    const zwischengespeichert = Number(cached?.marktpreis) || 0;
    if (zwischengespeichert > 0)
      return {
        preis: zwischengespeichert,
        abdeckung: cached?.coverage != null ? parseFloat(String(cached.coverage)) : null,
      };

    const parts = await k.katalog.minifigParts(figNumber);
    if (!parts.length) {
      console.log(`[minifig-price-estimate] ${figNumber}: keine Teile-Zusammensetzung von Rebrickable erhalten`);
      return null;
    }

    // In EINER Abfrage statt je Teil.
    await loadBlNumbersBefore(
      k,
      parts.filter((p: { bl_part_num?: string | null }) => !p.bl_part_num).map((p: { part_num: string }) => p.part_num),
    );

    const cond = cond0;

    let total = 0,
      priced = 0;
    for (const p of parts) {
      // Sonst übersetzt fetchPartPrice selbst und findet die Antwort im eben
      // gefüllten Gedächtnis.
      const blPartNum = p.bl_part_num || p.part_num;
      try {
        const priceData = await priceOrNone(
          fetchPartPrice(k, blPartNum, p.color_id ?? KEINE_FARBE, cond, currency, 24),
        );
        const unitPrice = marketPriceFrom(priceData);
        if (unitPrice !== null) {
          total += unitPrice * (p.quantity || 1);
          priced++;
        }
      } catch (e) {
        reportError('marktpreis:teil-in-figur', e);
      }
    }
    console.log(
      `[minifig-price-estimate] ${figNumber} (${cond}): ${priced}/${parts.length} Teile bepreist, geschätzt=${priced > 0 ? total.toFixed(2) : '—'}`,
    );
    if (priced === 0) return null;

    // In Cache und Verlauf, markiert als geschätzt: fetchMinifigPrice liest nur
    // unmarkierte Zeilen, die Anzeige kennzeichnet sie.
    const abdeckung = Math.round((priced / parts.length) * 1000) / 1000;
    // Zusammen, wie bei Sets (savePrice): Ein Cache ohne Verlaufspunkt hielte die
    // nächste Schätzung zurück. Ein Fehler endet unten als Meldung ohne Schätzung.
    await k.transaktion(async t => {
      await t.marktpreise.rememberEstimatedMinifigsPrice(figNumber, cond, currency, total, abdeckung);
      await t.marktpreise.rememberEstimatedMinifigsHistory(figNumber, cond, currency, total, abdeckung);
    });

    return { preis: total, abdeckung };
  } catch (e) {
    // Ausnahme: Die Schätzung ist ein Zusatz zum Marktpreis; ohne sie steht „kein Preis“ da.
    reportError(`figurenpreis-schaetzung:${figNumber}`, e);
    return null;
  }
}

export async function figMarketPriceWithOrigin(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
  // Eine „Gebraucht"-Erfassung genügt für 'U'; ohne Erfassung der Standard.
  let effCond = condition;
  if (!effCond) {
    try {
      const row = await k.marktpreise.minifigEntryState(userId, figNumber);
      if (row && parseInt(row.cnt, 10) > 0) effCond = Number(row.any_used) > 0 ? 'U' : 'N';
    } catch (e) {
      reportError('minifiguren:zustand-ermitteln', e);
    }
    if (!effCond) effCond = await k.einstellungen.userDefaultCondition(userId);
  }
  // BrickLink zuerst, auch ohne eigene bl_fig_number: Meist stimmt die eigene
  // Nummer mit der BrickLink-Nummer überein.
  for (const num of [blFigNumber, figNumber]) {
    if (!num) continue;
    const priceData = await priceOrNone(fetchMinifigPrice(k, num, effCond, currency, 24));
    // Der Rückfall wird übernommen, aber benannt — wie bei den Teilen.
    const price = marketPriceFrom(priceData);
    if (price !== null)
      return {
        preis: price,
        fromState: priceData?.is_fallback ? priceData.condition_used || null : null,
        geschaetzt: false,
      };
    if (num === blFigNumber && blFigNumber === figNumber) break; // nicht doppelt fragen
  }
  // Ohne Herkunftsangabe: Die Schätzung stammt nicht aus dem anderen Zustand.
  const schaetzung = await estimateMinifigsPrice(k, figNumber, userId, effCond);
  return {
    preis: schaetzung?.preis ?? null,
    fromState: null,
    geschaetzt: schaetzung != null,
    abdeckung: schaetzung?.abdeckung ?? null,
  };
}

export async function currentMinifigMarketPrice(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  return (await figMarketPriceWithOrigin(k, figNumber, userId, blFigNumber, condition)).preis;
}
