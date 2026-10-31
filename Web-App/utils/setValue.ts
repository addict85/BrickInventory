/**
 * Marktwert eines Sets aus den Erfassungen und den zustandsabhängigen Preisen.
 * Ausführlich: docs/begruendungen/utils/setValue.ts.md#abschnitt
 */
import * as db from '../db/database';
import { inZehntel4, aufRappen, alsText } from '../src/infra/geld';

export interface SetValue {
  /** Gewichteter Stückpreis — das, was Kachel und Detailansicht zeigen. */
  unit_price: number | null;
  /** Derselbe Stückpreis ungerundet, in Zehntausendsteln: Summen rechnen damit, nicht mit dem gerundeten. */
  unit_z: number | null;
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
  );

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

  let totalZ = 0, quantity = 0, priced = 0;
  const by_condition: SetValue['by_condition'] = [];

  for (const [condition, qty] of byCond) {
    const unit = priceFor(prices, setNumber, condition);
    by_condition.push({ condition, quantity: qty, unit_price: unit });
    quantity += qty;
    const z = inZehntel4(unit);
    if (z !== null) { totalZ += z * qty; priced += qty; }
  }

  // Kein einziger Zustand hat einen Preis → kein Wert, nicht 0. Eine 0 würde
  // in den Summen wie ein bekannter Wert von null Franken aussehen.
  if (priced === 0) return { unit_price: null, unit_z: null, total: null, quantity, by_condition };

  // Gewichtet über die BEPREISTEN Stück, damit ein fehlender Preis den
  // Stückpreis nicht nach unten zieht. Gerundet wird erst hier.
  return { unit_price: aufRappen(totalZ / priced), unit_z: totalZ / priced, total: aufRappen(totalZ), quantity, by_condition };
}

/**
 * Bequemlichkeitsfunktion für ein einzelnes Set: holt Erfassungen und Preise
 * selbst. Für Listen stattdessen loadConditionPrices() + valueSet() benutzen,
 * damit es bei einer Abfrage bleibt.
 */
export async function getSetValue(
  userId: number, setNumber: string, currency: string
): Promise<SetValue> {
  // Nur noch EINE Abfrage. Hier stand daneben ein `SELECT quantity, condition
  // FROM sets` für den Rückfall. Beides ist weggefallen:
  // Ausführlich: docs/begruendungen/utils/setValue.ts.md#getsetvalue-acqs
  const acqs = await db.all(
    'SELECT quantity, condition FROM set_acquisitions WHERE user_id=$1 AND set_number=$2',
    [userId, setNumber]);
  const prices = await loadConditionPrices([setNumber], currency);
  return valueSet(setNumber, acqs, prices, 'N', 1);
}

// ── Eine Zeile je Kaufpreis — für die Finanztabelle: Jede Erfassung steht mit
// dem Marktpreis IHRES Zustands da (valueSet() verdichtet auf einen Stückpreis).
// Ausführlich: docs/begruendungen/utils/setValue.ts.md#pnl-eps

/**
 * Entwicklung in Prozent gegen den Kaufpreis — die eine Regel für Sets, Teile,
 * Figuren, Kachel und Verlauf. null ohne Kauf- oder Marktpreis und bei
 * Kaufpreis 0: Gegen ein Geschenk gibt es keine Prozentzahl (gegen 0,01
 * gerechnet stand dort „+327.600 %“). Die Oberflächen zeigen „Geschenk“.
 */
export function entwicklungProzent(kauf: number | null | undefined, markt: number | null | undefined): number | null {
  if (kauf == null || !(kauf > 0) || markt == null || !(markt > 0)) return null;
  return (markt - kauf) / kauf * 100;
}

/** Wie pnlPct, als Zahl mit einer Stelle — für die Felder, die eine Zahl führen. */
export function pnlProzent(purchase: number | null, market: number | null): number | null {
  const t = pnlPct(purchase, market);
  return t === null ? null : Number(t);
}

/** Prozentuale Entwicklung — null, wenn Kaufpreis oder Marktpreis fehlt. */
export function pnlPct(purchase: number | null, market: number | null): string | null {
  return entwicklungProzent(purchase, market)?.toFixed(1) ?? null;
}

export interface AcquisitionValueRow {
  id: number;
  condition: 'N' | 'U';
  quantity: number;
  /** null = kein Kaufpreis erfasst. 0 = erfasst und geschenkt — nicht dasselbe. */
  purchase_price: number | null;
  avg_price: number | null;
  total_avg: string | null;
  /** total_avg als Zahl. */
  wert_gesamt: number | null;
  pnl_pct: string | null;
  /** pnl_pct als Zahl. */
  pnl_prozent: number | null;
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
      total_avg: unit != null ? alsText(aufRappen((inZehntel4(unit) ?? 0) * quantity)) : null,
      wert_gesamt: unit != null ? aufRappen((inZehntel4(unit) ?? 0) * quantity) : null,
      pnl_pct: pnlPct(purchase, unit),
      pnl_prozent: pnlProzent(purchase, unit),
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

export interface KachelQuelle {
  set_number: string; quantity: number; current_price: number | null;
  purchase_price: number | null; baseline_price: number | null;
  pnl_pct: string | null; baseline_pnl_pct: string | null;
}

/**
 * Betrag und G&V der Galeriekachel je Set. Im Haushalt hat ein Set mehrere
 * Zeilen (je Besitzer); dann zählt der nach Menge gewichtete Basispreis, weil
 * „irgendeine Zeile“ je nach Reihenfolge eine andere Prozentzahl ergäbe. Der
 * Betrag ist der Marktpreis, sonst der gewichtete Kaufpreis.
 */
export function kachelWerte(zeilen: KachelQuelle[]): Map<string, { kachel_preis: number | null; kachel_pnl_pct: number | null }> {
  const jeSet = new Map<string, KachelQuelle[]>();
  for (const z of zeilen) jeSet.set(z.set_number, [...(jeSet.get(z.set_number) || []), z]);
  const aus = new Map<string, { kachel_preis: number | null; kachel_pnl_pct: number | null }>();
  for (const [nr, zs] of jeSet) {
    const markt = Number(zs[0]?.current_price) || 0;
    const gewichtet = (feld: 'baseline_price' | 'purchase_price') => {
      let summe = 0, menge = 0;
      for (const z of zs) {
        const b = z[feld];
        if (b == null) continue;
        const m = Math.max(1, Number(z.quantity) || 1);
        summe += Number(b) * m; menge += m;
      }
      return menge > 0 ? summe / menge : null;
    };
    let pct: number | null;
    if (zs.length === 1) {
      const t = zs[0]!.baseline_pnl_pct || zs[0]!.pnl_pct;
      pct = t == null ? null : Number(t);
    } else {
      const basis = gewichtet('baseline_price');
      const e = entwicklungProzent(basis, markt);
      pct = e == null ? null : Math.round(e * 10) / 10;
    }
    const kauf = gewichtet('purchase_price');
    aus.set(nr, { kachel_preis: markt > 0 ? aufRappen(inZehntel4(markt) ?? 0) : (kauf != null ? aufRappen(inZehntel4(kauf) ?? 0) : null),
                  kachel_pnl_pct: pct });
  }
  return aus;
}
