/**
 * Marktwert eines Sets aus den Erfassungen und den zustandsabhängigen Preisen.
 *
 * ── Was vorher falsch war ───────────────────────────────────────────────────
 *
 * 1. Die Auswahl aus price_cache sortierte so:
 *
 *        ORDER BY (qty_avg_price > 0 OR avg_price > 0) DESC, (condition = $3) DESC
 *
 *    „Hat überhaupt einen Preis" stand VOR „passender Zustand". Lag für ein Set
 *    ein Gebraucht-Preis vor und der Neu-Eintrag war leer, gewann Gebraucht —
 *    auch wenn ausdrücklich Neu angefragt wurde. Genau so kam für 10290-1 ein
 *    deutlich zu niedriger Wert zustande.
 *
 * 2. Überall wurde `qty_avg_price || avg_price` genommen. qty_avg_price ist der
 *    mengengewichtete Schnitt und liegt systematisch unter dem, was BrickLink
 *    als „Avg Price" anzeigt. Dazu kommt eine JavaScript-Falle: Postgres
 *    liefert NUMERIC als String, und `"0.00"` ist truthy — ein leerer
 *    qty_avg_price verdeckte damit einen gültigen avg_price.
 *
 * 3. Ein Set hatte genau EINEN Marktpreis, unabhängig davon, wie sich seine
 *    Erfassungen zusammensetzen. Zwei Exemplare, eines neu, eines gebraucht,
 *    wurden beide mit demselben Preis bewertet.
 *
 * ── Die Regel jetzt ─────────────────────────────────────────────────────────
 *
 * Jede Erfassung wird mit dem avg_price IHRES Zustands bewertet:
 *
 *     Gesamtwert    = Σ (Menge_i × avg_price[Zustand_i])
 *     Stückpreis    = Gesamtwert / Σ Menge_i
 *
 * Das deckt beide Vorgaben ab:
 *   • 1× Neu, 1× Gebraucht → Gesamtwert = neu + gebraucht,
 *     angezeigter Stückpreis = (neu + gebraucht) / 2.
 *   • Nur Neu → Stückpreis = avg_price(Neu).
 *
 * Und es verallgemeinert sauber: Bei 2× Neu und 1× Gebraucht ergibt sich
 * (2·neu + gebraucht) / 3 als Stückpreis und 2·neu + gebraucht als Summe —
 * Anzeige × Menge bleibt also immer gleich der Summe. Ein reiner Mittelwert
 * über die vorkommenden Zustände täte das nicht.
 *
 * Fehlt der Preis für einen Zustand, wird auf den anderen ausgewichen; das ist
 * besser als die Erfassung mit 0 zu bewerten und die Summe zu verfälschen.
 * Sets ohne Erfassungen fallen auf sets.condition zurück.
 */
import * as db from '../db/database';

export interface SetValue {
  /** Gewichteter Stückpreis — das, was Kachel und Detailansicht zeigen. */
  unit_price: number | null;
  /** Gesamtwert aller Exemplare — das, was in die Summen eingeht. */
  total: number | null;
  /** Gesamtstückzahl, über die gewichtet wurde. */
  quantity: number;
  /** Je Zustand: Preis und Stückzahl — für Detailanzeige und Nachvollziehbarkeit. */
  by_condition: { condition: 'N' | 'U'; quantity: number; unit_price: number | null }[];
}

/** Numerischer Wert aus einer Postgres-NUMERIC-Spalte. `"0.00"` ergibt 0, nicht truthy. */
function num(v: any): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * avg_price je Zustand für mehrere Sets in EINER Abfrage.
 * @returns Map "setNumber|condition" → avg_price
 */
export async function loadConditionPrices(
  setNumbers: string[], currency: string, ttlHours?: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const list = [...new Set((setNumbers || []).filter(Boolean))];
  if (!list.length) return out;

  const ttlClause = ttlHours ? ' AND fetched_at > NOW() - make_interval(hours => $3)' : '';
  const params: any[] = [list, currency];
  if (ttlHours) params.push(ttlHours);

  // avg_price, NICHT qty_avg_price — siehe Modulkommentar.
  const rows = await db.all(
    `SELECT set_number, condition, avg_price
       FROM price_cache
      WHERE set_number = ANY($1) AND condition IN ('N','U') AND currency_code = $2${ttlClause}`,
    params
  ).catch(() => []);

  for (const r of rows) {
    const p = num(r.avg_price);
    if (p > 0) out.set(`${r.set_number}|${r.condition}`, p);
  }
  return out;
}

/** Preis für einen Zustand, mit Ausweichen auf den anderen. */
function priceFor(prices: Map<string, number>, setNumber: string, cond: string): number | null {
  const want  = prices.get(`${setNumber}|${cond}`);
  if (want) return want;
  const other = prices.get(`${setNumber}|${cond === 'N' ? 'U' : 'N'}`);
  return other || null;
}

/**
 * Bewertet ein Set anhand seiner Erfassungen.
 *
 * @param acquisitions Erfassungen des Sets ({ quantity, condition }). Leer =
 *        keine Erfassungen; dann zählt fallbackCondition mit fallbackQuantity.
 */
export function valueSet(
  setNumber: string,
  acquisitions: { quantity: number; condition?: string | null }[],
  prices: Map<string, number>,
  fallbackCondition: string = 'N',
  fallbackQuantity: number = 1
): SetValue {
  const rows = acquisitions?.length
    ? acquisitions.map(a => ({
        condition: (a.condition === 'U' ? 'U' : 'N') as 'N' | 'U',
        quantity: Math.max(1, parseInt(String(a.quantity)) || 1),
      }))
    : [{ condition: (fallbackCondition === 'U' ? 'U' : 'N') as 'N' | 'U',
         quantity: Math.max(1, fallbackQuantity) }];

  const byCond = new Map<'N' | 'U', number>();
  for (const r of rows) byCond.set(r.condition, (byCond.get(r.condition) || 0) + r.quantity);

  let total = 0, quantity = 0, priced = 0;
  const by_condition: SetValue['by_condition'] = [];

  for (const [condition, qty] of byCond) {
    const unit = priceFor(prices, setNumber, condition);
    by_condition.push({ condition, quantity: qty, unit_price: unit });
    quantity += qty;
    if (unit !== null) { total += unit * qty; priced += qty; }
  }

  // Kein einziger Zustand hat einen Preis → kein Wert, nicht 0. Eine 0 würde
  // in den Summen wie ein bekannter Wert von null Franken aussehen.
  if (priced === 0) return { unit_price: null, total: null, quantity, by_condition };

  return {
    // Gewichtet über die BEPREISTEN Stück, damit ein fehlender Preis den
    // Stückpreis nicht nach unten zieht.
    unit_price: Math.round((total / priced) * 100) / 100,
    total: Math.round(total * 100) / 100,
    quantity,
    by_condition,
  };
}

/**
 * Bequemlichkeitsfunktion für ein einzelnes Set: holt Erfassungen und Preise
 * selbst. Für Listen stattdessen loadConditionPrices() + valueSet() benutzen,
 * damit es bei einer Abfrage bleibt.
 */
export async function getSetValue(
  userId: number, setNumber: string, currency: string
): Promise<SetValue> {
  const [acqs, setRow] = await Promise.all([
    db.all('SELECT quantity, condition FROM set_acquisitions WHERE user_id=$1 AND set_number=$2',
      [userId, setNumber]).catch(() => []),
    db.get('SELECT quantity, condition FROM sets WHERE user_id=$1 AND set_number=$2',
      [userId, setNumber]).catch(() => null),
  ]);
  const prices = await loadConditionPrices([setNumber], currency);
  return valueSet(setNumber, acqs, prices,
    setRow?.condition || 'N', parseInt(setRow?.quantity) || 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Eine Zeile JE KAUFPREIS — für die Finanztabelle
// ═══════════════════════════════════════════════════════════════════════════
/**
 * valueSet() oben verdichtet auf EINEN Stückpreis je Set. Die Finanztabelle
 * zeigt seit hardened-90 aber eine Zeile je Kaufpreis-Erfassung: Ein Set mit
 * einem Kaufpreis für „Neu" und einem für „Gebraucht" steht dort mit zwei
 * Zeilen, jede mit dem Marktpreis IHRES Zustands.
 *
 * Diese Funktion gehört bewusst in DIESE Datei und nicht in eine eigene:
 * „Wie ein Set bewertet wird" liegt damit weiterhin an genau einer Stelle,
 * mitsamt dem Ausweichen auf den anderen Zustand (priceFor). Eine zweite Datei
 * mit derselben Regel ist in diesem Projekt schon mehrfach auseinandergelaufen
 * — zuletzt bei der Zustandsauflösung, die an fünf Orten leicht verschieden
 * war.
 *
 * Der Kaufpreis kommt hier dazu, weil er je Erfassung verschieden ist und die
 * Prozentangabe der Zeile gegen genau diesen Kaufpreis gerechnet werden muss.
 */

/** Nenner-Untergrenze: Kaufpreis 0 (Geschenk) ergäbe sonst keine Steigerung. */
export const PNL_EPS = 0.01;

/** Prozentuale Entwicklung — null, wenn Kaufpreis oder Marktpreis fehlt. */
export function pnlPct(purchase: number | null, market: number | null): string | null {
  if (purchase == null || !(market != null && market > 0)) return null;
  return ((market - purchase) / Math.max(purchase, PNL_EPS) * 100).toFixed(1);
}

export interface AcquisitionValueRow {
  id: number;
  condition: 'N' | 'U';
  quantity: number;
  /** null = kein Kaufpreis erfasst. 0 = erfasst und geschenkt — nicht dasselbe. */
  purchase_price: number | null;
  avg_price: number | null;
  total_avg: string | null;
  pnl_pct: string | null;
  created_at: any;
}

/**
 * Erfassungen einzeln bewerten.
 *
 * @param acquisitions Zeilen aus set_acquisitions
 * @param prices       Map "setNumber|condition" → avg_price (loadConditionPrices)
 */
export function valueAcquisitionRows(
  setNumber: string,
  acquisitions: any[],
  prices: Map<string, number>
): AcquisitionValueRow[] {
  return (acquisitions || []).map(a => {
    const condition: 'N' | 'U' = (a.condition === 'U') ? 'U' : 'N';
    const quantity = Math.max(1, parseInt(String(a.quantity)) || 1);
    // Sets führen den Kaufpreis als purchase_price, manuelle Teile und
    // Minifiguren als unit_price — dieselbe Grösse unter zwei Namen. Beide
    // hier zu lesen erspart je eine eigene Fassung dieser Funktion; die
    // Android-App macht es mit `effectivePrice` genauso.
    const raw = a.purchase_price ?? a.unit_price;
    const purchase = (raw === null || raw === undefined)
      ? null : (parseFloat(String(raw)) || 0);
    const unit = priceFor(prices, setNumber, condition);
    return {
      id: a.id,
      condition,
      quantity,
      purchase_price: purchase,
      avg_price: unit,
      total_avg: unit != null ? (unit * quantity).toFixed(2) : null,
      pnl_pct: pnlPct(purchase, unit),
      created_at: a.created_at ?? null,
    };
  });
}

/**
 * Mengengewichteter Kaufpreis über die Erfassungen.
 *
 * Nur über die Zeilen MIT erfasstem Kaufpreis: Eine Erfassung ohne Preis zöge
 * den Schnitt sonst gegen null und liesse die Sammlung teurer erscheinen, als
 * sie war.
 */
export function weightedPurchase(rows: AcquisitionValueRow[]): number | null {
  const withCost = (rows || []).filter(r => r.purchase_price != null);
  const qty = withCost.reduce((s, r) => s + r.quantity, 0);
  if (!qty) return null;
  return withCost.reduce((s, r) => s + (r.purchase_price as number) * r.quantity, 0) / qty;
}
