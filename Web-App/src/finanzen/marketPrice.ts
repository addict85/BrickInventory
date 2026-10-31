import * as repo from './repository/marktpreise';
import { nacharbeit } from '../auftraege/nacharbeit';
import { getSetValue } from './setValue';
import { nutzerStandardZustand as userDefaultCondition } from '../konto/settings';
import { getGlobalSetting } from '../konto/settings';
import { DEFAULT_PRICE_CONDITION, fetchPartPrice, fetchMinifigPrice, ladeBlNummernVor,
         resolveBlPartNumber, resolveBlColorId } from './rechnung/preise';
import { getSetting } from '../konto/settings';
import { meldeUndWeiter, fehlertext, logAndContinue, meldeUndLiefere } from '../infra/httpError';
import { getMinifigParts } from '../katalog/rebrickableKatalog';
import { KEINE_FARBE } from '../infra/validate';

// Ausführlich: docs/begruendungen/src/finanzen/marketPrice.ts.md#getcurrentmarketprice
export async function getCurrentMarketPrice(setNumber: string, userId: number, condition: string | null = null) {
  try {
    const currency = String(await getSetting(userId, 'currency', 'EUR'));
    // Parameter → Nutzer → global → 'N'.
    const effectiveCond = condition || await userDefaultCondition(userId).catch(()=>DEFAULT_PRICE_CONDITION);
    // condition als Hinweis: Beim Anlegen gibt es noch keine Erfassung, aus der
    // der Preislauf den Zustand ablesen könnte.
    await nacharbeit().preisFuerSetHolen(setNumber, userId, condition).catch(logAndContinue('marktpreis:preisFuerSetHolen'));

    // Ein ausdrücklich angefragter Zustand gilt genau so: Beim Anlegen gibt es
    // noch keine Erfassung, aus der getSetValue() ihn ableiten könnte.
    if (!condition) {
      // Ohne ausdrücklichen Wunsch: Bewertung je Erfassung nach deren Zustand.
      const v = await getSetValue(userId, setNumber, currency);
      if (v.unit_price !== null) return v.unit_price;
    }

    // Angefragter Zustand zuerst; der andere nur, wenn dort kein Preis steht.
    const cached = await repo.setPreisAusCache(setNumber, effectiveCond, currency);
    const price = parseFloat(cached?.avg_price ?? '0');
    return price > 0 ? price : null;
  } catch (_) { return null; }
}

// Marktpreise für Sets, Teile und Figuren an einer Stelle, damit die Zustandsregel
// nicht je Art auseinanderläuft.

/** 'U' sobald eine Erfassung gebraucht ist; ohne Erfassung der Standard. */
export async function resolvePartCondition(userId: number, partNumber: string, colorId: number) {
  try {
    const row = await repo.teilErfassungsZustand(userId, partNumber, colorId);
    if (row && parseInt(row.cnt) > 0) return Number(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) { meldeUndWeiter('teile:zustand-ermitteln', e); }
  try { return await userDefaultCondition(userId); }
  catch (_) { return DEFAULT_PRICE_CONDITION; }
}

/** Nur aus dem Cache, ohne Abruf: Die Liste soll nicht auf BrickLink warten.
 * Ausführlich: docs/begruendungen/src/finanzen/marketPrice.ts.md#marktpreiseauscachefuerfiguren */
export async function marktpreiseAusCacheFuerFiguren(
  figuren: Array<{ fig_number?: string | null; bl_fig_number?: string | null; condition?: string | null }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!figuren.length) return treffer;

  const [currency, ttlRoh] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRoh)));

  // Beide Schreibweisen: fetchMinifigPrice() legt unter der BL-Nummer ab, die
  // Schätzung unter der RB-Nummer.
  const schluessel = [...new Set(figuren.flatMap(f =>
    [f.bl_fig_number, f.fig_number].filter(Boolean).map(String)))];
  if (!schluessel.length) return treffer;

  const zeilen = await repo.figurenpreiseAusCache(schluessel, String(currency), ttl)
    .catch(meldeUndLiefere('marktpreis:zeilen', []));

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = parseFloat(String(z.avg_price || 0)) || parseFloat(String(z.qty_avg_price || 0)) || 0;
    if (wert > 0) cache.set(`${z.fig_number}|${z.condition}`, wert);
  }

  for (const f of figuren) {
    const nummer = String(f.fig_number ?? '');
    if (!nummer) continue;
    const zustand = f.condition === 'U' ? 'U' : 'N';
    const anders  = zustand === 'N' ? 'U' : 'N';
    // Reihenfolge wie in der Bewertung; BrickLink führt zu vielen älteren Figuren
    // nur einen der beiden Zustände.
    for (const k of [f.bl_fig_number, f.fig_number].filter(Boolean).map(String))
      for (const c of [zustand, anders]) {
        const wert = cache.get(`${k}|${c}`);
        if (wert != null) { treffer.set(nummer, wert); break; }
      }
    if (treffer.has(nummer)) continue;
  }
  return treffer;
}

// Ausführlich: docs/begruendungen/src/finanzen/marketPrice.ts.md#marktpreiseauscachefuerteile
export async function marktpreiseAusCacheFuerTeile(
  teile: Array<{ part_number?: string | null; bl_part_number?: string | null;
                 color_id?: number | null; condition?: string | null }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!teile.length) return treffer;

  const [currency, ttlRoh] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRoh)));

  await ladeBlNummernVor(teile.map(t => String(t.bl_part_number || t.part_number || '')));

  // Die Schlüssel, unter denen fetchPartPrice geschrieben hätte.
  const auflösung = new Map<string, { nummer: string; farbe: number }>();
  for (const t of teile) {
    const roh = String(t.bl_part_number || t.part_number || '');
    if (!roh) continue;
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    if (auflösung.has(schluessel)) continue;
    auflösung.set(schluessel, {
      nummer: await resolveBlPartNumber(roh),
      farbe:  Number(await resolveBlColorId(Number(t.color_id ?? KEINE_FARBE))) || 0,
    });
  }

  const nummern = [...new Set([...auflösung.values()].map(a => a.nummer))];
  if (!nummern.length) return treffer;
  const zeilen = await repo.teilepreiseAusCache(nummern, String(currency), ttl)
    .catch(meldeUndLiefere('marktpreis:zeilen', []));

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = parseFloat(String(z.avg_price || 0)) || parseFloat(String(z.qty_avg_price || 0)) || 0;
    if (wert > 0) cache.set(`${z.part_number}|${z.color_id}|${z.condition}`, wert);
  }

  for (const t of teile) {
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    const a = auflösung.get(schluessel);
    if (!a) continue;
    const zustand = t.condition === 'U' ? 'U' : 'N';
    for (const c of [zustand, zustand === 'N' ? 'U' : 'N']) {
      const wert = cache.get(`${a.nummer}|${a.farbe}|${c}`);
      if (wert != null) { treffer.set(schluessel, wert); break; }
    }
  }
  return treffer;
}

/** Mit Herkunft für die eine Stelle, die sie zeigt; alle anderen nehmen die Zahl.
 * Ausführlich: docs/begruendungen/src/finanzen/marketPrice.ts.md#marktpreismitherkunft */
export async function marktpreisMitHerkunft(partNumber: string, colorId: number, userId: number, condition: string | null = null) {
  try {
    const currency  = await getSetting(userId, 'currency', 'EUR');
    const ttlHours  = 24;
    const effCond   = condition || await resolvePartCondition(userId, partNumber, colorId);
    const priceData = await fetchPartPrice(partNumber, colorId, effCond, currency, ttlHours);
    // avg_price wie bei den Sets: BrickLinks angezeigter Preis, und "0.00" ist truthy.
    const price = parseFloat(priceData?.avg_price || 0);
    if (!(price > 0)) return { preis: null, ausZustand: null };
    // Der Rückfall auf den anderen Zustand wird übernommen, aber benannt: Gar
    // kein Preis war schlechter als ein gekennzeichneter.
    // Ausführlich: docs/begruendungen/src/finanzen/marketPrice.ts.md#marktpreismitherkunft-2
    return {
      preis: price,
      ausZustand: priceData?.is_fallback ? (priceData.condition_used || null) : null,
    };
  } catch (_) { return { preis: null, ausZustand: null }; }
}

export async function getCurrentPartMarketPrice(partNumber: string, colorId: number, userId: number, condition: string | null = null) {
  return (await marktpreisMitHerkunft(partNumber, colorId, userId, condition)).preis;
}

export async function estimateFigPriceFromParts(figNumber: string, userId: number, condition = DEFAULT_PRICE_CONDITION) {
  return (await schaetzeFigurenpreis(figNumber, userId, condition))?.preis ?? null;
}

/** Die Abdeckung (Anteil der Teile mit Preis) sagt, wie belastbar die Zahl ist. */
export async function schaetzeFigurenpreis(figNumber: string, userId: number, condition = DEFAULT_PRICE_CONDITION): Promise<{ preis: number; abdeckung: number | null } | null> {
  try {
    const currency = await getSetting(userId, 'currency', 'EUR');
    const cond0 = ['N','U'].includes(condition) ? condition : DEFAULT_PRICE_CONDITION;

    // Erst im Cache nachsehen: Sonst kostete jede Figur je Teil einen Abruf.
    const ttl = Math.max(1, parseInt(await getGlobalSetting('price_cache_ttl', '24')));
    const cached = await repo.geschaetzterFigurenpreis(figNumber, cond0, currency, ttl)
      .catch(meldeUndLiefere('marktpreis:cached', null));
    const zwischengespeichert = parseFloat(String(cached?.avg_price || 0));
    if (zwischengespeichert > 0)
      return { preis: zwischengespeichert, abdeckung: cached?.abdeckung != null ? parseFloat(String(cached.abdeckung)) : null };

    const parts = await getMinifigParts(figNumber);
    if (!parts.length) {
      console.log(`[minifig-price-estimate] ${figNumber}: keine Teile-Zusammensetzung von Rebrickable erhalten`);
      return null;
    }

    // In EINER Abfrage statt je Teil.
    await ladeBlNummernVor(parts
      .filter((p: { bl_part_num?: string | null }) => !p.bl_part_num)
      .map((p: { part_num: string }) => p.part_num));

    const cond = cond0;

    let total = 0, priced = 0;
    for (const p of parts) {
      // Sonst übersetzt fetchPartPrice selbst und findet die Antwort im eben
      // gefüllten Gedächtnis.
      const blPartNum = p.bl_part_num || p.part_num;
      try {
        const priceData = await fetchPartPrice(blPartNum, p.color_id ?? KEINE_FARBE, cond, currency, 24);
        const unitPrice = parseFloat(priceData?.avg_price || 0);
        if (unitPrice > 0) { total += unitPrice * (p.quantity || 1); priced++; }
      } catch (_) { /* Teil ohne Preis — überspringen */ }
    }
    console.log(`[minifig-price-estimate] ${figNumber} (${cond}): ${priced}/${parts.length} Teile bepreist, geschätzt=${priced>0?total.toFixed(2):'—'}`);
    if (priced === 0) return null;

    // In Cache und Verlauf, markiert als geschätzt: fetchMinifigPrice liest nur
    // unmarkierte Zeilen, die Anzeige kennzeichnet sie.
    const abdeckung = Math.round(priced / parts.length * 1000) / 1000;
    await repo.merkeGeschaetztenFigurenpreis(figNumber, cond, currency, total, abdeckung)
      .catch(e => console.warn(`[minifig-price-estimate] Cache ${figNumber}: ${e.message}`));
    // Nur mit echtem Preis: Ein Nullpunkt sähe im Diagramm aus wie ein Kurssturz.
    await repo.merkeGeschaetztenFigurenverlauf(figNumber, cond, currency, total, abdeckung)
      .catch(logAndContinue('marktpreis:figurverlauf schreiben'));

    return { preis: total, abdeckung };
  } catch (e) {
    console.warn(`[minifig-price-estimate] ${figNumber}: ${fehlertext(e)}`);
    return null;
  }
}

export async function figMarktpreisMitHerkunft(figNumber: string, userId: number, blFigNumber?: string | null, condition: string | null = null) {
  try {
    const currency = await getSetting(userId, 'currency', 'EUR');
    // Eine „Gebraucht"-Erfassung genügt für 'U'; ohne Erfassung der Standard.
    let effCond = condition;
    if (!effCond) {
      try {
        const row = await repo.figurErfassungsZustand(userId, figNumber);
        if (row && parseInt(row.cnt) > 0) effCond = Number(row.any_used) > 0 ? 'U' : 'N';
      } catch (e) { meldeUndWeiter('minifiguren:zustand-ermitteln', e); }
      if (!effCond) { try { effCond = await userDefaultCondition(userId); } catch (_) { effCond = DEFAULT_PRICE_CONDITION; } }
    }
    // BrickLink zuerst, auch ohne eigene bl_fig_number: Meist stimmt die eigene
    // Nummer mit der BrickLink-Nummer überein.
    for (const num of [blFigNumber, figNumber]) {
      if (!num) continue;
      const priceData = await fetchMinifigPrice(num, effCond, currency, 24).catch(meldeUndLiefere('marktpreis:fetchMinifigPrice', null));
      // Der Rückfall wird übernommen, aber benannt — wie bei den Teilen.
      const price = parseFloat(priceData?.avg_price || 0);
      if (price > 0) return {
        preis: price,
        ausZustand: priceData?.is_fallback ? (priceData.condition_used || null) : null,
        geschaetzt: false,
      };
      if (num === blFigNumber && blFigNumber === figNumber) break;   // nicht doppelt fragen
    }
    // Ohne Herkunftsangabe: Die Schätzung stammt nicht aus dem anderen Zustand.
    const schaetzung = await schaetzeFigurenpreis(figNumber, userId, effCond);
    return { preis: schaetzung?.preis ?? null, ausZustand: null, geschaetzt: schaetzung != null,
             abdeckung: schaetzung?.abdeckung ?? null };
  } catch (_) { return { preis: null, ausZustand: null, geschaetzt: false }; }
}

export async function getCurrentFigMarketPrice(figNumber: string, userId: number, blFigNumber?: string | null, condition: string | null = null) {
  return (await figMarktpreisMitHerkunft(figNumber, userId, blFigNumber, condition)).preis;
}

