import * as db from '../db/database';
import { nacharbeit } from './nacharbeit';
import { getSetValue } from './setValue';
import { nutzerStandardZustand as userDefaultCondition } from './settings';
import { getGlobalSetting } from './settings';
import { DEFAULT_PRICE_CONDITION, fetchPartPrice, fetchMinifigPrice, ladeBlNummernVor,
         resolveBlPartNumber, resolveBlColorId } from './finance/preise';
import { getSetting } from './settings';
import { meldeUndWeiter, fehlertext } from './httpError';
import { getMinifigParts } from '../clients/rebrickable';

/**
 * Der aktuelle Marktpreis eines Sets.
 * Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#getcurrentmarketprice
 */

async function getCurrentMarketPrice(setNumber: string, userId: number, condition: string | null = null) {
  try {
    const currencyRow = await db.get('SELECT value FROM user_settings WHERE user_id=$1 AND key=$2', [userId, 'currency']);
    const globalCurrency = await getGlobalSetting('currency');
    const currency = currencyRow?.value || globalCurrency || 'EUR';
    // Effective condition: parameter → user setting → global setting → 'N'
    const effectiveCond = condition || await userDefaultCondition(userId).catch(()=>DEFAULT_PRICE_CONDITION);
    // condition als Hinweis mitgeben: Beim Anlegen eines neuen Sets existieren
    // weder sets- noch set_acquisitions-Zeile schon, refreshPriceForSet könnte
    // sonst nur den Standardzustand holen (siehe jobs/priceJob.ts).
    await nacharbeit().preisFuerSetHolen(setNumber, userId, condition).catch(() => {});

    // Ist ein Zustand AUSDRÜCKLICH angefragt, gilt genau der.
    //
    // Sonst entschied getSetValue() anhand der Erfassungen — und beim Anlegen
    // eines neuen Sets gibt es noch keine. Die Funktion fiel dann auf
    // sets.condition zurück, das ebenfalls noch nicht geschrieben war, also auf
    // 'N'. Ein als gebraucht erfasstes Set bekam so den Neupreis (55 statt 33).
    // Der weiter oben berechnete effectiveCond wurde nur im unerreichbaren
    // Rückfall darunter benutzt.
    if (!condition) {
      // Ohne ausdrücklichen Wunsch: Bewertung je Erfassung nach deren Zustand
      // (utils/setValue.ts) — das ist der richtige Wert für eine Anzeige.
      const v = await getSetValue(userId, setNumber, currency);
      if (v.unit_price !== null) return v.unit_price;
    }

    // Angefragter Zustand zuerst; der andere nur, wenn dort kein Preis steht.
    const cached = await db.get(
      `SELECT avg_price FROM price_cache
       WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 AND avg_price > 0
       ORDER BY (condition = $2) DESC LIMIT 1`,
      [setNumber, effectiveCond, currency]
    );
    const price = parseFloat(cached?.avg_price || 0);
    return price > 0 ? price : null;
  } catch (_) { return null; }
}


/**
 * Warum die Teile- und Figurenpreise jetzt AUCH hier stehen
 * Diese Datei fuehrte den Marktpreis fuer SETS. Die Pendants fuer Teile und
 * Minifiguren wohnten in routes/parts.ts und routes/minifigs.ts — dieselbe
 * Frage, dreimal beantwortet, an drei Orten in zwei Schichten. Wer die Regel …
 * Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#abschnitt
 */

// Default the purchase price to the current BrickLink market price for a part,
// when the user did not enter one manually.
// Effektiver Zustand eines Teils für die Preisabfrage: sobald eine Erfassung
// "Gebraucht" ist → 'U', sonst 'N'; ohne Erfassungen der User-Default. Der
// eigentliche Preis-Fallback (gewünschter Zustand → jeweils anderer) steckt in
// fetchPartPrice.
async function resolvePartCondition(userId: number, partNumber: string, colorId: number) {
  try {
    const row = await db.get(
      "SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3",
      // parseInt entfaellt: colorId ist bereits eine Zahl (V.colorId gibt
      // number zurueck). parseInt(5) ging nur ueber den Umweg ueber "5".
      [userId, partNumber, colorId || 0]);
    if (row && parseInt(row.cnt) > 0) return parseInt(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) { meldeUndWeiter('teile:zustand-ermitteln', e); }
  try { return await userDefaultCondition(userId); }
  catch (_) { return DEFAULT_PRICE_CONDITION; }
}

/**
 * Marktpreise fuer eine ganze LISTE — nur aus dem Cache, ohne einen einzigen
 * Abruf bei BrickLink.
 * Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#marktpreiseauscachefuerfiguren
 */
async function marktpreiseAusCacheFuerFiguren(
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

  // Beide Schreibweisen abfragen: fetchMinifigPrice() legt unter der
  // BrickLink-Nummer ab, estimateFigPriceFromParts() unter der
  // Rebrickable-Nummer. Welche eine Figur hat, weiss man erst an der Zeile.
  const schluessel = [...new Set(figuren.flatMap(f =>
    [f.bl_fig_number, f.fig_number].filter(Boolean).map(String)))];
  if (!schluessel.length) return treffer;

  const zeilen = await db.all(
    `SELECT fig_number, condition, avg_price, qty_avg_price FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [schluessel, currency, ttl],
  ).catch(() => []);

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
    // Reihenfolge wie in der Bewertung: BrickLink-Nummer vor
    // Rebrickable-Nummer, eigener Zustand vor dem anderen. Der Rueckfall auf
    // den anderen Zustand ist derselbe wie in fetchMinifigPrice — BrickLink
    // fuehrt zu vielen aelteren Figuren nur einen von beiden.
    for (const k of [f.bl_fig_number, f.fig_number].filter(Boolean).map(String))
      for (const c of [zustand, anders]) {
        const wert = cache.get(`${k}|${c}`);
        if (wert != null) { treffer.set(nummer, wert); break; }
      }
    if (treffer.has(nummer)) continue;
  }
  return treffer;
}

/**
 * Dasselbe fuer manuell erfasste TEILE — siehe die Begruendung oben.
 * Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#marktpreiseauscachefuerteile
 */
async function marktpreiseAusCacheFuerTeile(
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

  // Je Teil die Schluessel bestimmen, mit denen fetchPartPrice geschrieben
  // haette: uebersetzte Nummer, uebersetzte Farbe.
  const auflösung = new Map<string, { nummer: string; farbe: number }>();
  for (const t of teile) {
    const roh = String(t.bl_part_number || t.part_number || '');
    if (!roh) continue;
    const schluessel = `${t.part_number}|${t.color_id ?? 0}`;
    if (auflösung.has(schluessel)) continue;
    auflösung.set(schluessel, {
      nummer: await resolveBlPartNumber(roh),
      farbe:  Number(await resolveBlColorId(Number(t.color_id ?? 0))) || 0,
    });
  }

  const nummern = [...new Set([...auflösung.values()].map(a => a.nummer))];
  if (!nummern.length) return treffer;
  const zeilen = await db.all(
    `SELECT part_number, color_id, condition, avg_price, qty_avg_price FROM part_price_cache
      WHERE part_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [nummern, currency, ttl],
  ).catch(() => []);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = parseFloat(String(z.avg_price || 0)) || parseFloat(String(z.qty_avg_price || 0)) || 0;
    if (wert > 0) cache.set(`${z.part_number}|${z.color_id}|${z.condition}`, wert);
  }

  for (const t of teile) {
    const schluessel = `${t.part_number}|${t.color_id ?? 0}`;
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

/**
 * Marktpreis eines Teils SAMT Herkunft.
 * Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#marktpreismitherkunft
 */
async function marktpreisMitHerkunft(partNumber: string, colorId: number, userId: number, condition: string | null = null) {
  try {
    const currency  = await getSetting(userId, 'currency', 'EUR');
    const ttlHours  = 24;
    const effCond   = condition || await resolvePartCondition(userId, partNumber, colorId);
    const priceData = await fetchPartPrice(partNumber, colorId || 0, effCond, currency, ttlHours);
    // avg_price statt qty_avg_price — dieselbe Begründung wie bei den Sets:
    // der mengengewichtete Schnitt liegt unter BrickLinks "Avg Price", und
    // "0.00" aus Postgres ist truthy und hätte avg_price verdeckt.
    const price = parseFloat(priceData?.avg_price || 0);
    if (!(price > 0)) return { preis: null, ausZustand: null };
    // Der Rückfall wird übernommen, aber benannt
    // Früher stand hier `if (priceData?.is_fallback) return null` —
    // als Antwort auf Marcos Befund, dass der Zustand keinen Einfluss auf den
    // Preis hat. Der Befund stimmte, die Folge war zu scharf: Marco meldete …
    // Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#marktpreismitherkunft-2
    return {
      preis: price,
      ausZustand: priceData?.is_fallback ? (priceData.condition_used || null) : null,
    };
  } catch (_) { return { preis: null, ausZustand: null }; }
}

/**
 * Marktpreis eines Teils als blosse Zahl — der Weg fuer alle, die die
 * Herkunft nicht brauchen. EINE Rechnung, zwei Sichten darauf.
 */
async function getCurrentPartMarketPrice(partNumber: string, colorId: number, userId: number, condition: string | null = null) {
  return (await marktpreisMitHerkunft(partNumber, colorId, userId, condition)).preis;
}


/** Geschätzter Figurenpreis als blosse Zahl — für Aufrufer ohne Abdeckung. */
async function estimateFigPriceFromParts(figNumber: string, userId: number, condition = DEFAULT_PRICE_CONDITION) {
  return (await schaetzeFigurenpreis(figNumber, userId, condition))?.preis ?? null;
}

/**
 * Figurenpreis aus den Teilepreisen, samt Abdeckung: dem Anteil der Teile, die
 * einen Preis hatten. Die Abdeckung sagt, wie belastbar die Zahl ist.
 */
async function schaetzeFigurenpreis(figNumber: string, userId: number, condition = DEFAULT_PRICE_CONDITION): Promise<{ preis: number; abdeckung: number | null } | null> {
  try {
    const currency = await getSetting(userId, 'currency', 'EUR');
    const cond0 = ['N','U'].includes(condition) ? condition : DEFAULT_PRICE_CONDITION;

    // Erst im Cache nachsehen
    // GESCHRIEBEN wurde er schon (unten, samt Verlaufspunkt) — GELESEN nie. Jeder
    // Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable und
    // danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen …
    // Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#estimatefigpricefromparts-ttl
    const ttl = Math.max(1, parseInt(await getGlobalSetting('price_cache_ttl', '24')));
    const cached = await db.get(
      `SELECT avg_price, abdeckung FROM minifig_price_cache
        WHERE fig_number = $1 AND condition = $2 AND currency_code = $3 AND geschaetzt
          AND fetched_at > NOW() - make_interval(hours => $4)`,
      [figNumber, cond0, currency, ttl]
    ).catch(() => null);
    const zwischengespeichert = parseFloat(String(cached?.avg_price || 0));
    if (zwischengespeichert > 0)
      return { preis: zwischengespeichert, abdeckung: cached?.abdeckung != null ? parseFloat(String(cached.abdeckung)) : null };

    const parts = await getMinifigParts(figNumber);
    if (!parts.length) {
      console.log(`[minifig-price-estimate] ${figNumber}: keine Teile-Zusammensetzung von Rebrickable erhalten`);
      return null;
    }

    // BrickLink-Nummern für Teile ohne external_ids in EINER Abfrage vorladen
    // (statt pro Teil eine eigene Query — vermeidet N+1).
    // Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#estimatefigpricefromparts
    await ladeBlNummernVor(parts
      .filter((p: { bl_part_num?: string | null }) => !p.bl_part_num)
      .map((p: { part_num: string }) => p.part_num));

    const cond = cond0;

    let total = 0, priced = 0;
    for (const p of parts) {
      // BrickLink-Nummer bevorzugt aus Rebrickables external_ids; sonst
      // uebersetzt fetchPartPrice selbst (resolveBlPartNumber) und findet die
      // Antwort im eben gefuellten Gedaechtnis.
      const blPartNum = p.bl_part_num || p.part_num;
      try {
        const priceData = await fetchPartPrice(blPartNum, p.color_id || 0, cond, currency, 24);
        const unitPrice = parseFloat(priceData?.avg_price || 0);
        if (unitPrice > 0) { total += unitPrice * (p.quantity || 1); priced++; }
      } catch (_) { /* Teil ohne Preis — überspringen */ }
    }
    console.log(`[minifig-price-estimate] ${figNumber} (${cond}): ${priced}/${parts.length} Teile bepreist, geschätzt=${priced>0?total.toFixed(2):'—'}`);
    if (priced === 0) return null;

    // Die Schätzung gehört in Cache UND Verlauf
    // Gemeldet: Im Detail-Dialog einer Minifigur OHNE BrickLink-Nummer standen
    // bei „Marktpreis (Neu)" und „Marktpreis (Gebraucht)" nur Striche, und der
    // Preisverlauf blieb leer — obwohl Kaufpreise in beiden Zuständen erfasst …
    // Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#estimatefigpricefromparts-2
    // Die Markierung trennt die Schätzung vom BrickLink-Preis: fetchMinifigPrice
    // liest nur unmarkierte Zeilen, die Anzeige kennzeichnet die markierten.
    const abdeckung = Math.round(priced / parts.length * 1000) / 1000;
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, abdeckung)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=$4, qty_avg_price=$4, fetched_at=NOW(), geschaetzt=TRUE, abdeckung=$5`,
      [figNumber, cond, currency, total, abdeckung]
    ).catch(e => console.warn(`[minifig-price-estimate] Cache ${figNumber}: ${e.message}`));
    // Wie beim echten Abruf: ON CONFLICT DO NOTHING, und nur mit echtem Preis —
    // ein Nullpunkt sähe im Diagramm aus wie ein Kurssturz.
    await db.run(
      `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, abdeckung)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT DO NOTHING`,
      [figNumber, cond, currency, total, abdeckung]
    ).catch(() => {});

    return { preis: total, abdeckung };
  } catch (e) {
    console.warn(`[minifig-price-estimate] ${figNumber}: ${fehlertext(e)}`);
    return null;
  }
}

/**
 * Marktpreis einer Minifigur SAMT Herkunft — Zwilling zu
 * marktpreisMitHerkunft in routes/parts.ts, gleiche Begruendung dort.
 */
async function figMarktpreisMitHerkunft(figNumber: string, userId: number, blFigNumber?: string | null, condition: string | null = null) {
  try {
    const currency = await getSetting(userId, 'currency', 'EUR');
    // Effektiver Zustand: eine "Gebraucht"-Erfassung genügt → 'U', sonst 'N';
    // ohne Erfassungen der User-Default. fetchMinifigPrice fällt bei leerem
    // Price Guide selbst auf den jeweils anderen Zustand zurück.
    let effCond = condition;
    if (!effCond) {
      try {
        const row = await db.get(
          "SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2",
          [userId, figNumber]);
        if (row && parseInt(row.cnt) > 0) effCond = parseInt(row.any_used) > 0 ? 'U' : 'N';
      } catch (e) { meldeUndWeiter('minifiguren:zustand-ermitteln', e); }
      if (!effCond) { try { effCond = await userDefaultCondition(userId); } catch (_) { effCond = DEFAULT_PRICE_CONDITION; } }
    }
    // BrickLink zuerst — und zwar auch OHNE separate bl_fig_number.
    // Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#figmarktpreismitherkunft
    for (const num of [blFigNumber, figNumber]) {
      if (!num) continue;
      const priceData = await fetchMinifigPrice(num, effCond, currency, 24).catch(() => null);
      // Der Rueckfall wird uebernommen, aber benannt
      // Die Antwort damals war `continue` — also gar kein Preis. Darauf kam
      // Marcos naechster Befund: „Teilweise wird der Kaufpreis nicht direkt
      // geladen." Beides ist dieselbe Tatsache von zwei Seiten: BrickLink …
      // Ausführlich: docs/begruendungen/utils/marketPrice.ts.md#figmarktpreismitherkunft-price
      const price = parseFloat(priceData?.avg_price || 0);
      if (price > 0) return {
        preis: price,
        ausZustand: priceData?.is_fallback ? (priceData.condition_used || null) : null,
        geschaetzt: false,
      };
      if (num === blFigNumber && blFigNumber === figNumber) break;   // nicht doppelt fragen
    }
    // Bei BrickLink nichts gefunden: über die Teile der Minifigur schätzen —
    // im ERMITTELTEN Zustand, nicht im Standardzustand.
    //
    // Ohne Herkunft: Die Schätzung rechnet mit den Teilepreisen DIESES
    // Zustands. Sie ist eine Näherung, aber keine aus dem anderen Zustand —
    // und nur die wäre zu kennzeichnen.
    const schaetzung = await schaetzeFigurenpreis(figNumber, userId, effCond);
    return { preis: schaetzung?.preis ?? null, ausZustand: null, geschaetzt: schaetzung != null,
             abdeckung: schaetzung?.abdeckung ?? null };
  } catch (_) { return { preis: null, ausZustand: null, geschaetzt: false }; }
}

/**
 * Marktpreis einer Minifigur als blosse Zahl — für alle, die die Herkunft
 * nicht brauchen. Zwilling zu getCurrentPartMarketPrice in routes/parts.ts.
 */
async function getCurrentFigMarketPrice(figNumber: string, userId: number, blFigNumber?: string | null, condition: string | null = null) {
  return (await figMarktpreisMitHerkunft(figNumber, userId, blFigNumber, condition)).preis;
}

export {
  getCurrentMarketPrice,
  resolvePartCondition, marktpreisMitHerkunft, getCurrentPartMarketPrice,
  marktpreiseAusCacheFuerFiguren, marktpreiseAusCacheFuerTeile,
  estimateFigPriceFromParts, schaetzeFigurenpreis, figMarktpreisMitHerkunft, getCurrentFigMarketPrice,
};
