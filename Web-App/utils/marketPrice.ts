import * as db from '../db/database';
import { refreshPriceForSet } from '../jobs/priceJob';
import { getSetValue } from './setValue';
import { nutzerStandardZustand as userDefaultCondition } from './settings';
import { getGlobalSetting } from './settings';
import { DEFAULT_PRICE_CONDITION, fetchPartPrice, fetchMinifigPrice, ladeBlNummernVor } from './financeCalc';
import { getSetting } from './settings';
import { meldeUndWeiter, fehlertext } from './httpError';
import { getMinifigParts } from '../clients/rebrickable';

/**
 * Der aktuelle Marktpreis eines Sets.
 *
 * ── Warum nicht mehr in routes/sets.ts (Nachtrag 125) ───────────────────────
 * Sieben Aufrufer, keiner konnte sie importieren: Der Router schliesst mit
 * parts/minifigs/jobs mehrere Kreise, also holten alle sie per spätem
 * `require()` — und damit ungeprüft. Genau diese Sorte Aufruf hat in Nachtrag
 * 131 zwei 500er verursacht.
 *
 * Hier ist sie ein Blatt: db, priceJob, setValue, settings — kein Rückbezug.
 * Das späte `require('../utils/setValue')` im Rumpf konnte dabei ebenfalls
 * durch einen echten Import ersetzt werden.
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
    await refreshPriceForSet(setNumber, userId, condition).catch(() => {});

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
 * ── Warum die Teile- und Figurenpreise jetzt AUCH hier stehen ───────────────
 *
 * Diese Datei fuehrte den Marktpreis fuer SETS. Die Pendants fuer Teile und
 * Minifiguren wohnten in routes/parts.ts und routes/minifigs.ts — dieselbe
 * Frage, dreimal beantwortet, an drei Orten in zwei Schichten. Wer die Regel
 * aendert (etwa avg_price statt qty_avg_price, oder die Behandlung eines
 * Zustands-Rueckfalls), aendert sie an einem Ort und uebersieht die anderen:
 * genau die Bauart von Fehler, gegen die dieser Baum sonst ueberall angeht.
 *
 * Sichtbar wurde es daran, dass jobs/purchasePriceBackfill.ts und
 * utils/financeCalc.ts aus einer ROUTE importieren mussten, um an einen Preis
 * zu kommen.
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
 * Marktpreis eines Teils SAMT Herkunft.
 *
 * Zwei Funktionen statt einer: Die allermeisten Aufrufer (Bewertung,
 * Nachtrag-Job, Erfassungs-Route) wollen eine Zahl und nichts weiter — ihnen
 * eine Herkunft aufzuzwingen, die sie wegwerfen, machte sechs Aufrufstellen
 * umstaendlicher, damit eine es bequemer hat. Nur der Weg „von Hand erfassen"
 * kennzeichnet den Rueckfall, und nur er fragt hier.
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
    // ── Der Rückfall wird übernommen, aber benannt (Nachtrag 167) ───────────
    //
    // In Nachtrag 166 stand hier `if (priceData?.is_fallback) return null` —
    // als Antwort auf Marcos Befund, dass der Zustand keinen Einfluss auf den
    // Preis hat. Der Befund stimmte, die Folge war zu scharf: Marco meldete
    // darauf „teilweise wird der Kaufpreis nicht direkt geladen", weil
    // BrickLink zu vielen Teilen nur einen der beiden Zustände führt.
    //
    // Seine Entscheidung: übernehmen und kennzeichnen. `ausZustand` trägt
    // deshalb den Zustand, aus dem der Wert wirklich stammt — die Oberfläche
    // sagt es dann dazu, statt dass eine Zahl unkommentiert dasteht.
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


async function estimateFigPriceFromParts(figNumber: string, userId: number, condition = DEFAULT_PRICE_CONDITION) {
  try {
    const currency = await getSetting(userId, 'currency', 'EUR');
    const cond0 = ['N','U'].includes(condition) ? condition : DEFAULT_PRICE_CONDITION;

    // ── Erst im Cache nachsehen (Nachtrag 144) ────────────────────────────────
    //
    // Marcos Auftrag: „Der geschätzte Marktpreis soll ebenfalls im Cache
    // gespeichert werden, damit er nicht jedes Mal neu geholt werden muss."
    //
    // GESCHRIEBEN wurde er schon (unten, samt Verlaufspunkt) — GELESEN nie. Jeder
    // Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable und
    // danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen
    // kostete fünfzehn Preisabfragen, bei jedem Öffnen der Finanzseite.
    //
    // Dieselbe Frist wie beim echten Abruf (price_cache_ttl, Vorgabe 24 h): Der
    // Wert ist derselbe Marktpreis, nur anders ermittelt — er soll nicht länger
    // gelten als ein von BrickLink geholter.
    const ttl = Math.max(1, parseInt(await getGlobalSetting('price_cache_ttl', '24')));
    const cached = await db.get(
      `SELECT avg_price FROM minifig_price_cache
        WHERE fig_number = $1 AND condition = $2 AND currency_code = $3
          AND fetched_at > NOW() - make_interval(hours => $4)`,
      [figNumber, cond0, currency, ttl]
    ).catch(() => null);
    const zwischengespeichert = parseFloat(String(cached?.avg_price || 0));
    if (zwischengespeichert > 0) return zwischengespeichert;

    const parts = await getMinifigParts(figNumber);
    if (!parts.length) {
      console.log(`[minifig-price-estimate] ${figNumber}: keine Teile-Zusammensetzung von Rebrickable erhalten`);
      return null;
    }

    // BrickLink-Nummern für Teile ohne external_ids in EINER Abfrage vorladen
    // (statt pro Teil eine eigene Query — vermeidet N+1).
    //
    // Die Abfrage stand hier zeichengleich ein zweites Mal (jetzt
    // ladeBlNummernVor in utils/financeCalc.ts); test/sql-kerne.test.js hat es
    // gemeldet. Uebersetzt wird seither nicht mehr HIER, sondern unten in
    // fetchPartPrice — die Antwort liegt dann im gemeinsamen Gedaechtnis.
    //
    // Ein Unterschied bleibt und ist gewollt: ladeBlNummernVor kennt neben
    // rb_bl_mapping auch den Rueckfall ueber parts.bl_part_number. Ein Teil,
    // dessen Zuordnung nur dort steht, wurde vorher NICHT uebersetzt — genau
    // die Luecke, die resolveBlPartNumber ueberall sonst schliesst.
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

    // ── Die Schätzung gehört in Cache UND Verlauf ─────────────────────────────
    //
    // Gemeldet: Im Detail-Dialog einer Minifigur OHNE BrickLink-Nummer standen
    // bei „Marktpreis (Neu)" und „Marktpreis (Gebraucht)" nur Striche, und der
    // Preisverlauf blieb leer — obwohl Kaufpreise in beiden Zuständen erfasst
    // waren und die Finanzliste einen Wert zeigte.
    //
    // Ursache: Die Schätzung wurde bei jedem Aufruf frisch gerechnet und
    // nirgends abgelegt. Marktpreis-Zeile und Diagramm lesen aber
    // minifig_price_cache bzw. minifig_price_history (utils/priceHistory.ts) —
    // und genau für diese Figuren blieb dort für immer alles leer. Ein echter
    // BrickLink-Abruf schreibt beide Tabellen seit jeher (fetchMinifigPrice);
    // der Schätzpfad war der einzige, der es nicht tat.
    //
    // Beide Tabellen sind benutzerunabhängig — das passt: Die Schätzung stammt
    // aus BrickLink-Teilepreisen, nicht aus dem Bestand des Nutzers. Nur die
    // Währung kommt aus seinen Einstellungen und steht deshalb im Schlüssel.
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
       VALUES ($1,$2,$3,$4,$4) ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=$4, qty_avg_price=$4, fetched_at=NOW()`,
      [figNumber, cond, currency, total]
    ).catch(e => console.warn(`[minifig-price-estimate] Cache ${figNumber}: ${e.message}`));
    // Wie beim echten Abruf: ON CONFLICT DO NOTHING, und nur mit echtem Preis —
    // ein Nullpunkt sähe im Diagramm aus wie ein Kurssturz.
    await db.run(
      `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price)
       VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
      [figNumber, cond, currency, total]
    ).catch(() => {});

    return total;
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
    //
    // Vorher lief der Abruf nur, wenn eine abweichende BrickLink-Nummer
    // hinterlegt war. Bei einer manuell erfassten Figur ist das der Ausnahme-
    // und nicht der Regelfall: Meist stimmt die eigene Nummer (sw0001 &c.)
    // mit der BrickLink-Nummer überein. Der Abruf wurde dadurch übersprungen,
    // die Teile-Schätzung übernahm — und die liefert ohne
    // Teile-Zusammensetzung von Rebrickable nichts. Ergebnis: gar kein Preis.
    //
    // Reihenfolge wie gewünscht: BrickLink, und nur wenn dort nichts zu holen
    // ist, die Schätzung über die Einzelteile.
    for (const num of [blFigNumber, figNumber]) {
      if (!num) continue;
      const priceData = await fetchMinifigPrice(num, effCond, currency, 24).catch(() => null);
      // ── Der Rueckfall wird uebernommen, aber benannt (Nachtrag 167) ───────
      //
      // Marcos Befund aus Nachtrag 166: „Wenn ich eine Minifigur mit dem
      // Zustand neu oder gebraucht erfasse, erhaelt diese denselben Preis."
      // Er stimmte — fetchMinifigPrice faellt bei leerem Price Guide auf den
      // anderen Zustand zurueck und markiert das mit `is_fallback`, und diese
      // Stelle warf die Markierung weg.
      //
      // Die Antwort damals war `continue` — also gar kein Preis. Darauf kam
      // Marcos naechster Befund: „Teilweise wird der Kaufpreis nicht direkt
      // geladen." Beides ist dieselbe Tatsache von zwei Seiten: BrickLink
      // fuehrt zu vielen Figuren nur EINEN Zustand.
      //
      // Seine Entscheidung: uebernehmen und kennzeichnen. Der Wert kommt
      // zurueck, und mit ihm der Zustand, aus dem er wirklich stammt.
      const price = parseFloat(priceData?.avg_price || 0);
      if (price > 0) return {
        preis: price,
        ausZustand: priceData?.is_fallback ? (priceData.condition_used || null) : null,
      };
      if (num === blFigNumber && blFigNumber === figNumber) break;   // nicht doppelt fragen
    }
    // Bei BrickLink nichts gefunden: über die Teile der Minifigur schätzen —
    // im ERMITTELTEN Zustand, nicht im Standardzustand.
    //
    // Ohne Herkunft: Die Schätzung rechnet mit den Teilepreisen DIESES
    // Zustands. Sie ist eine Näherung, aber keine aus dem anderen Zustand —
    // und nur die wäre zu kennzeichnen.
    return { preis: await estimateFigPriceFromParts(figNumber, userId, effCond), ausZustand: null };
  } catch (_) { return { preis: null, ausZustand: null }; }
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
  estimateFigPriceFromParts, figMarktpreisMitHerkunft, getCurrentFigMarketPrice,
};
