import { getSetValue } from './setValue';
import {
  DEFAULT_PRICE_CONDITION,
  fetchPartPrice,
  fetchMinifigPrice,
  ladeBlNummernVor,
  preisOderKeiner,
  resolveBlPartNumber,
  resolveBlColorId,
} from './rechnung/preise';
import { meldeFehler, fehlertext, logAndContinue } from '../infra/fehler';
import { marktpreisAus } from '../katalog';
import { KEINE_FARBE, zustand } from '../infra/validate';
import type { FinanzenKontext } from './kontext';

// Ein Blatt ohne Rückbezug, damit die Aufrufer echt importieren statt spät mit require().
export async function getCurrentMarketPrice(
  k: FinanzenKontext,
  setNumber: string,
  userId: number,
  condition: string | null = null,
) {
  const currency = String(await k.einstellungen.getSetting(userId, 'currency', 'EUR'));
  // Parameter → Nutzer → global → 'N'.
  const effectiveCond = condition || (await k.einstellungen.nutzerStandardZustand(userId));
  // condition als Hinweis: Beim Anlegen gibt es noch keine Erfassung, aus der
  // der Preislauf den Zustand ablesen könnte.
  await k.nacharbeit
    .preisFuerSetHolen(setNumber, userId, condition)
    .catch(logAndContinue('marktpreis:preisFuerSetHolen'));

  // Ein ausdrücklich angefragter Zustand gilt genau so: Beim Anlegen gibt es
  // noch keine Erfassung, aus der getSetValue() ihn ableiten könnte.
  if (!condition) {
    // Ohne ausdrücklichen Wunsch: Bewertung je Erfassung nach deren Zustand.
    const v = await getSetValue(k, userId, setNumber, currency);
    if (v.unit_price !== null) return v.unit_price;
  }

  // Angefragter Zustand zuerst; der andere nur, wenn dort kein Preis steht.
  const cached = await k.marktpreise.setPreisAusCache(setNumber, effectiveCond, currency);
  return cached ? Number(cached.marktpreis) : null;
}

// Marktpreise für Sets, Teile und Figuren an einer Stelle, damit die Zustandsregel
// nicht je Art auseinanderläuft.

/** 'U' sobald eine Erfassung gebraucht ist; ohne Erfassung der Standard. */
export async function resolvePartCondition(k: FinanzenKontext, userId: number, partNumber: string, colorId: number) {
  try {
    const row = await k.marktpreise.teilErfassungsZustand(userId, partNumber, colorId);
    if (row && parseInt(row.cnt, 10) > 0) return Number(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) {
    meldeFehler('teile:zustand-ermitteln', e);
  }
  return k.einstellungen.nutzerStandardZustand(userId);
}

/** Nur aus dem Cache, ohne Abruf: Die Liste soll nicht auf BrickLink warten. */
export async function marktpreiseAusCacheFuerFiguren(
  kx: FinanzenKontext,
  figuren: Array<{ fig_number?: string | null; bl_fig_number?: string | null; condition?: string | null }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!figuren.length) return treffer;

  const [currency, ttlRoh] = await Promise.all([
    kx.einstellungen.getSetting(viewerId, 'currency', 'EUR'),
    kx.einstellungen.getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRoh), 10));

  // Beide Schreibweisen: fetchMinifigPrice() legt unter der BL-Nummer ab, die
  // Schätzung unter der RB-Nummer.
  const schluessel = [...new Set(figuren.flatMap(f => [f.bl_fig_number, f.fig_number].filter(Boolean).map(String)))];
  if (!schluessel.length) return treffer;

  // Ohne Fang: Die Liste fasst den Fehler als `degradiert` (Abstriche) und zeigt sie ohne Preis.
  const zeilen = await kx.marktpreise.figurenpreiseAusCache(schluessel, String(currency), ttl);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = marktpreisAus(z);
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
export async function marktpreiseAusCacheFuerTeile(
  k: FinanzenKontext,
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

  const [currency, ttlRoh] = await Promise.all([
    k.einstellungen.getSetting(viewerId, 'currency', 'EUR'),
    k.einstellungen.getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRoh), 10));

  await ladeBlNummernVor(
    k,
    teile.map(t => String(t.bl_part_number || t.part_number || '')),
  );

  // Die Schlüssel, unter denen fetchPartPrice geschrieben hätte.
  const auflösung = new Map<string, { nummer: string; farbe: number }>();
  for (const t of teile) {
    const roh = String(t.bl_part_number || t.part_number || '');
    if (!roh) continue;
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    if (auflösung.has(schluessel)) continue;
    auflösung.set(schluessel, {
      nummer: await resolveBlPartNumber(k, roh),
      farbe: Number(await resolveBlColorId(k, Number(t.color_id ?? KEINE_FARBE))) || 0,
    });
  }

  const nummern = [...new Set([...auflösung.values()].map(a => a.nummer))];
  if (!nummern.length) return treffer;
  const zeilen = await k.marktpreise.teilepreiseAusCache(nummern, String(currency), ttl);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = marktpreisAus(z);
    if (wert !== null) cache.set(`${z.part_number}|${z.color_id}|${z.condition}`, wert);
  }

  for (const t of teile) {
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    const a = auflösung.get(schluessel);
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
export async function marktpreisMitHerkunft(
  k: FinanzenKontext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  const currency = await k.einstellungen.getSetting(userId, 'currency', 'EUR');
  const ttlHours = (await k.einstellungen.getGlobalSetting('price_cache_ttl', '24')) || '24';
  const effCond = condition || (await resolvePartCondition(k, userId, partNumber, colorId));
  const priceData = await preisOderKeiner(
    fetchPartPrice(k, partNumber, colorId, effCond, currency, ttlHours, null, userId),
  );
  const price = marktpreisAus(priceData);
  if (price === null) return { preis: null, ausZustand: null };
  // Der Rückfall auf den anderen Zustand wird übernommen, aber benannt: Gar
  // kein Preis war schlechter als ein gekennzeichneter.
  return {
    preis: price,
    ausZustand: priceData?.is_fallback ? priceData.condition_used || null : null,
  };
}

export async function getCurrentPartMarketPrice(
  k: FinanzenKontext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  return (await marktpreisMitHerkunft(k, partNumber, colorId, userId, condition)).preis;
}

export async function estimateFigPriceFromParts(
  k: FinanzenKontext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
) {
  return (await schaetzeFigurenpreis(k, figNumber, userId, condition))?.preis ?? null;
}

/** Die Abdeckung (Anteil der Teile mit Preis) sagt, wie belastbar die Zahl ist. */
export async function schaetzeFigurenpreis(
  k: FinanzenKontext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
): Promise<{ preis: number; abdeckung: number | null } | null> {
  try {
    const currency = await k.einstellungen.getSetting(userId, 'currency', 'EUR');
    const cond0 = zustand(condition, DEFAULT_PRICE_CONDITION);

    // Erst im Cache nachsehen: Sonst kostete jede Figur je Teil einen Abruf.
    const ttl = Math.max(1, parseInt(await k.einstellungen.getGlobalSetting('price_cache_ttl', '24'), 10));
    const cached = await k.marktpreise.geschaetzterFigurenpreis(figNumber, cond0, currency, ttl);
    const zwischengespeichert = Number(cached?.marktpreis) || 0;
    if (zwischengespeichert > 0)
      return {
        preis: zwischengespeichert,
        abdeckung: cached?.abdeckung != null ? parseFloat(String(cached.abdeckung)) : null,
      };

    const parts = await k.katalog.getMinifigParts(figNumber);
    if (!parts.length) {
      console.log(`[minifig-price-estimate] ${figNumber}: keine Teile-Zusammensetzung von Rebrickable erhalten`);
      return null;
    }

    // In EINER Abfrage statt je Teil.
    await ladeBlNummernVor(
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
        const priceData = await preisOderKeiner(
          fetchPartPrice(k, blPartNum, p.color_id ?? KEINE_FARBE, cond, currency, 24),
        );
        const unitPrice = marktpreisAus(priceData);
        if (unitPrice !== null) {
          total += unitPrice * (p.quantity || 1);
          priced++;
        }
      } catch (e) {
        meldeFehler('marktpreis:teil-in-figur', e);
      }
    }
    console.log(
      `[minifig-price-estimate] ${figNumber} (${cond}): ${priced}/${parts.length} Teile bepreist, geschätzt=${priced > 0 ? total.toFixed(2) : '—'}`,
    );
    if (priced === 0) return null;

    // In Cache und Verlauf, markiert als geschätzt: fetchMinifigPrice liest nur
    // unmarkierte Zeilen, die Anzeige kennzeichnet sie.
    const abdeckung = Math.round((priced / parts.length) * 1000) / 1000;
    await k.marktpreise
      .merkeGeschaetztenFigurenpreis(figNumber, cond, currency, total, abdeckung)
      .catch(e => console.warn(`[minifig-price-estimate] Cache ${figNumber}: ${e.message}`));
    // Nur mit echtem Preis: Ein Nullpunkt sähe im Diagramm aus wie ein Kurssturz.
    await k.marktpreise
      .merkeGeschaetztenFigurenverlauf(figNumber, cond, currency, total, abdeckung)
      .catch(logAndContinue('marktpreis:figurverlauf schreiben'));

    return { preis: total, abdeckung };
  } catch (e) {
    console.warn(
      `[minifig-price-estimate] ${figNumber}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
    );
    return null;
  }
}

export async function figMarktpreisMitHerkunft(
  k: FinanzenKontext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  const currency = await k.einstellungen.getSetting(userId, 'currency', 'EUR');
  // Eine „Gebraucht"-Erfassung genügt für 'U'; ohne Erfassung der Standard.
  let effCond = condition;
  if (!effCond) {
    try {
      const row = await k.marktpreise.figurErfassungsZustand(userId, figNumber);
      if (row && parseInt(row.cnt, 10) > 0) effCond = Number(row.any_used) > 0 ? 'U' : 'N';
    } catch (e) {
      meldeFehler('minifiguren:zustand-ermitteln', e);
    }
    if (!effCond) effCond = await k.einstellungen.nutzerStandardZustand(userId);
  }
  // BrickLink zuerst, auch ohne eigene bl_fig_number: Meist stimmt die eigene
  // Nummer mit der BrickLink-Nummer überein.
  for (const num of [blFigNumber, figNumber]) {
    if (!num) continue;
    const priceData = await preisOderKeiner(fetchMinifigPrice(k, num, effCond, currency, 24));
    // Der Rückfall wird übernommen, aber benannt — wie bei den Teilen.
    const price = marktpreisAus(priceData);
    if (price !== null)
      return {
        preis: price,
        ausZustand: priceData?.is_fallback ? priceData.condition_used || null : null,
        geschaetzt: false,
      };
    if (num === blFigNumber && blFigNumber === figNumber) break; // nicht doppelt fragen
  }
  // Ohne Herkunftsangabe: Die Schätzung stammt nicht aus dem anderen Zustand.
  const schaetzung = await schaetzeFigurenpreis(k, figNumber, userId, effCond);
  return {
    preis: schaetzung?.preis ?? null,
    ausZustand: null,
    geschaetzt: schaetzung != null,
    abdeckung: schaetzung?.abdeckung ?? null,
  };
}

export async function getCurrentFigMarketPrice(
  k: FinanzenKontext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  return (await figMarktpreisMitHerkunft(k, figNumber, userId, blFigNumber, condition)).preis;
}
