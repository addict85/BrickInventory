/** Je Erfassung mit dem Preis ihres Zustands, weil gemischte Bestände sonst
 * einen falschen Durchschnitt bekämen.
 * Ausführlich: docs/begruendungen/src/finanzen/setValue.ts.md#abschnitt */
import { inZehntel4, aufRappen, alsText } from '../infra/geld';
import * as repo from './repository/setWert';

export interface SetValue {
  unit_price: number | null;
  /** Ungerundet, in Zehntausendsteln: Summen rechnen damit, nicht mit dem gerundeten. */
  unit_z: number | null;
  total: number | null;
  quantity: number;
  by_condition: { condition: 'N' | 'U'; quantity: number; unit_price: number | null }[];
}

/** `"0.00"` aus NUMERIC ergibt 0, nicht truthy. */
function num(v: any): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** In EINER Abfrage für viele Sets.
 * @returns Map "setNumber|condition" → avg_price */
export async function loadConditionPrices(
  setNumbers: string[], currency: string, ttlHours?: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const list = [...new Set((setNumbers || []).filter(Boolean))];
  if (!list.length) return out;

  const ttlClause = ttlHours ? ' AND fetched_at > NOW() - make_interval(hours => $3)' : '';
  const params: any[] = [list, currency];
  if (ttlHours) params.push(ttlHours);

  // avg_price, NICHT qty_avg_price: BrickLinks angezeigter Preis.
  const rows = await repo.cachePreiseFuerSets(params, ttlClause);

  for (const r of rows) {
    const p = num(r.avg_price);
    if (p > 0) out.set(`${r.set_number}|${r.condition}`, p);
  }
  return out;
}

function priceFor(prices: Map<string, number>, setNumber: string, cond: string): number | null {
  const want  = prices.get(`${setNumber}|${cond}`);
  if (want) return want;
  const other = prices.get(`${setNumber}|${cond === 'N' ? 'U' : 'N'}`);
  return other || null;
}

/** @param acquisitions Leer = keine Erfassungen; dann zählt fallbackCondition
 *        mit fallbackQuantity. */
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

  // Kein Zustand hat einen Preis → kein Wert, nicht 0: Eine 0 sähe in den
  // Summen aus wie ein bekannter Wert.
  if (priced === 0) return { unit_price: null, unit_z: null, total: null, quantity, by_condition };

  // Über die BEPREISTEN Stück, damit ein fehlender Preis den Stückpreis nicht
  // nach unten zieht. Gerundet wird erst hier.
  return { unit_price: aufRappen(totalZ / priced), unit_z: totalZ / priced, total: aufRappen(totalZ), quantity, by_condition };
}

/** Für Listen loadConditionPrices() + valueSet(), damit es bei einer Abfrage bleibt. */
export async function getSetValue(
  userId: number, setNumber: string, currency: string
): Promise<SetValue> {
  const acqs = await repo.setErfassungenZumWert(userId, setNumber);
  const prices = await loadConditionPrices([setNumber], currency);
  return valueSet(setNumber, acqs, prices, 'N', 1);
}

// Jede Erfassung mit dem Marktpreis IHRES Zustands — für die Finanztabelle.
// Ausführlich: docs/begruendungen/src/finanzen/setValue.ts.md#pnl-eps

/** Die eine Regel für Sets, Teile, Figuren, Kachel und Verlauf. null bei
 * Kaufpreis 0: Gegen ein Geschenk gibt es keine Prozentzahl (gegen 0,01
 * stand dort „+327.600 %"). */
export function entwicklungProzent(kauf: number | null | undefined, markt: number | null | undefined): number | null {
  if (kauf == null || !(kauf > 0) || markt == null || !(markt > 0)) return null;
  return (markt - kauf) / kauf * 100;
}

export function pnlProzent(purchase: number | null, market: number | null): number | null {
  const t = pnlPct(purchase, market);
  return t === null ? null : Number(t);
}

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
  wert_gesamt: number | null;
  pnl_pct: string | null;
  pnl_prozent: number | null;
  created_at: any;
  /** Ein Kaufpreis in fremder Währung ohne Kurs: Er zählt nicht mit, steht aber da. */
  kaufpreis_original?: number;
  kaufpreis_waehrung?: string;
  price_estimated?: true;
}

/** @param prices Map "setNumber|condition" → avg_price (loadConditionPrices) */
export function valueAcquisitionRows(
  setNumber: string,
  acquisitions: any[],
  prices: Map<string, number>
): AcquisitionValueRow[] {
  return (acquisitions || []).map(a => {
    const condition: 'N' | 'U' = (a.condition === 'U') ? 'U' : 'N';
    const quantity = Math.max(1, parseInt(String(a.quantity)) || 1);
    // purchase_price (Sets) und unit_price (manuell) sind dieselbe Grösse unter
    // zwei Namen; beide lesen erspart je eine Fassung dieser Funktion.
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
      ...(a.kaufpreis_fremd && a.kaufpreis_original != null
        ? { kaufpreis_original: parseFloat(String(a.kaufpreis_original)), kaufpreis_waehrung: String(a.currency) } : {}),
      ...(a.price_estimated && purchase != null ? { price_estimated: true as const } : {}),
    };
  });
}

/** Nur über Zeilen MIT Kaufpreis: Eine Erfassung ohne Preis zöge den Schnitt
 * sonst gegen null. */
export function weightedPurchase(rows: AcquisitionValueRow[]): number | null {
  const withCost = (rows || []).filter(r => r.purchase_price != null);
  const qty = withCost.reduce((s, r) => s + r.quantity, 0);
  if (!qty) return null;
  return withCost.reduce((s, r) => s + (r.purchase_price as number) * r.quantity, 0) / qty;
}

export interface KachelWert { kachel_preis: number | null; kachel_pnl_pct: number | null; kachel_quelle: 'markt' | 'kauf' | null }

export interface KachelQuelle {
  set_number: string; quantity: number; current_price: number | null;
  purchase_price: number | null; baseline_price: number | null;
  pnl_pct: string | null; baseline_pnl_pct: string | null;
}

/** Im Haushalt zählt der nach Menge gewichtete Basispreis: „Irgendeine Zeile"
 * ergäbe je nach Reihenfolge eine andere Prozentzahl. */
export function kachelWerte(zeilen: KachelQuelle[]): Map<string, KachelWert> {
  const jeSet = new Map<string, KachelQuelle[]>();
  for (const z of zeilen) jeSet.set(z.set_number, [...(jeSet.get(z.set_number) || []), z]);
  const aus = new Map<string, KachelWert>();
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
    const quelle = markt > 0 ? 'markt' : kauf != null ? 'kauf' : null;
    aus.set(nr, { kachel_preis: quelle === 'markt' ? aufRappen(inZehntel4(markt) ?? 0) : (kauf != null ? aufRappen(inZehntel4(kauf) ?? 0) : null),
                  kachel_pnl_pct: pct, kachel_quelle: quelle });
  }
  return aus;
}
