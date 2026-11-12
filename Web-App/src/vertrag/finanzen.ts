import { z } from 'zod';
import { type Route, KontoName, zeit, abfrage, Q, veraltet, PROZENT_TEXT, SEITE, SEITEN_ANGABE } from './grund';
import { FigValuationItem, PartValuationItem, ValuationAcquisition } from './gemeinsam';

export const ChartPoint = z.looseObject({
  x_label: z.string(),
  value: z.number(),
  y_frac: z.number(),
});

export const ChartYAxis = z.looseObject({
  label: z.string(),
  value: z.number(),
  frac: z.number(),
});

export const ConditionValuation = z.looseObject({
  market_price: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable().optional(),
});

export const DashboardStats = z.looseObject({
  currency: z.string().nullable().optional(),
  default_condition: z.string().nullable().optional(),
  user_default_condition: z.string().nullable().optional(),
  total_sets: z.number().int(),
  total_quantity: z.number().int(),
  total_pieces: z.number().int(),
  total_instructions: z.number().int(),
  total_parts: z.number().int(),
  set_parts: z.number().int().optional(),
  manual_parts: z.number().int().optional(),
  total_minifigs: z.number().int(),
});

export const FigsValuationResponse = z.looseObject({
  kaufpreise_umgerechnet: z.number().int().nullable().optional(),
  success: z.boolean(),
  ...SEITEN_ANGABE,
  currency: z.string(),
  figs: z.array(FigValuationItem),
  total_value: veraltet(z.string(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable(),
  preise_ausstehend: z.number().int().optional(),
  kaufpreise_fremde_waehrung: z.number().int(),
  error: z.string().nullable().optional(),
});

export const PartsValuationResponse = z.looseObject({
  kaufpreise_umgerechnet: z.number().int().nullable().optional(),
  success: z.boolean(),
  ...SEITEN_ANGABE,
  currency: z.string(),
  parts: z.array(PartValuationItem),
  total_value: veraltet(z.string(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable(),
  preise_ausstehend: z.number().int().optional(),
  kaufpreise_fremde_waehrung: z.number().int(),
  error: z.string().nullable().optional(),
});

export const PnlTotals = z.looseObject({
  kaufpreise_umgerechnet: z.number().int().nullable().optional(),
  pnl_current: z.union([z.string(), z.number()]).nullable().optional(),
  pnl_purchase: z.union([z.string(), z.number()]).nullable().optional(),
  purchase: z.string(),
  current: z.string(),
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable().optional(),
  kaufpreise_fremde_waehrung: z.number().int(),
  sets_purchase: z.string().nullable().optional(),
  parts_purchase: z.string().nullable().optional(),
  figs_purchase: z.string().nullable().optional(),
  grand_total: z.string().nullable().optional(),
  positionen: z.number().int().optional(),
  positionen_bewertet: z.number().int().optional(),
  positionen_ohne_marktpreis: z.number().int().optional(),
  positionen_ohne_kaufpreis: z.number().int().optional(),
  basis_einstand: z.string().optional(),
  basis_marktwert: z.string().optional(),
  basis_guv_betrag: z.string().optional(),
  ohne_marktpreis_einstand: z.string().optional(),
  ohne_kaufpreis_marktwert: z.string().optional(),
});

export const PnlSetZeile = z.looseObject({
  added_at: zeit.nullable().optional(),
  condition: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  pnl_abs: z.string().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  year: z.number().int().nullable().optional(),
  set_number: z.string(),
  quantity: z.number().int(),
  current_price: z.number().nullable().optional(),
  baseline_price: z.number().nullable().optional(),
  pnl_pct: PROZENT_TEXT,
  baseline_pnl_pct: veraltet(z.string().nullable().optional(), 'baseline_pnl_prozent'),
  pnl_betrag: z.number().nullable().optional(),
  pnl_prozent: z.number().nullable().optional(),
  baseline_pnl_prozent: z.number().nullable().optional(),
  kachel_preis: z.number().nullable().optional(),
  kachel_pnl_pct: z.number().nullable().optional(),
  kachel_quelle: z.enum(['markt', 'kauf']).nullable().optional(),
});

export const PnlResponse = z.looseObject({
  success: z.boolean(),
  ...SEITEN_ANGABE,
  currency: z.string(),
  totals: PnlTotals,
  sets: z.array(PnlSetZeile),
  error: z.string().nullable().optional(),
});

export const PriceByCondition = z.looseObject({
  N: ConditionValuation.nullable().optional(),
  U: ConditionValuation.nullable().optional(),
});

export const PriceChartPoint = z.looseObject({
  x: z.string(),
  y: z.number(),
});

export const PriceChartSeries = z.looseObject({
  name: z.string(),
  values: z.array(PriceChartPoint),
  firstRealIndex: z.number().int(),
});

export const PriceChartData = z.looseObject({
  values: z.array(PriceChartSeries),
  x: z.array(z.string()),
});

export const PortfolioHistoryResponse = z.looseObject({
  chart: PriceChartData.optional(),
  messpunkte: z.number().int().nullable().optional(),
  success: z.boolean(),
  currency: z.string(),
  period: z.string(),
  points: z.array(ChartPoint),
  y_axis: z.array(ChartYAxis),
  period_change_pct: z.number().nullable().optional(),
  purchase_total: z.string().nullable().optional(),
});

export const PriceHistoryPoint = z.looseObject({
  is_purchase_price: z.boolean().optional(),
  recorded_at: zeit,
  qty_avg_price: z.number().nullable().optional(),
  avg_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
});

export const PriceHistoryResponse = z.looseObject({
  condition: z.string().nullable().optional(),
  current: z.unknown().optional(),
  success: z.boolean(),
  /** Nur beim Set. */
  set_number: z.string().optional(),
  currency: z.string(),
  history_new: z.array(PriceHistoryPoint),
  history_used: z.array(PriceHistoryPoint),
  by_condition: PriceByCondition,
  chart: PriceChartData,
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
});

export const SetPriceResponse = z.looseObject({
  from_cache: z.boolean().optional(),
  success: z.boolean(),
  set_number: z.string(),
  currency: z.string(),
  avg_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
  qty_avg_price: z.number().nullable().optional(),
  no_price: z.boolean(),
});

export const StatsResponse = z.looseObject({
  success: z.boolean(),
  stats: DashboardStats.nullable().optional(),
});

export const Totals = z.looseObject({
  min: z.string(),
  avg: z.string(),
  max: z.string(),
  qty_avg: z.string(),
});

export const ValuationSet = z.looseObject({
  bl_unbekannt: z.boolean().optional(),
  condition: z.string().nullable().optional(),
  conditions: z.array(z.string()).optional(),
  error_code: z.string().nullable().optional(),
  pnl_pct: PROZENT_TEXT,
  user_id: z.number().int().nullable().optional(),
  set_number: z.string(),
  added_at: zeit.nullable().optional(),
  name: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  quantity: z.number().int(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  min_price: z.number().nullable().optional(),
  avg_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
  qty_avg_price: z.number().nullable().optional(),
  total_qty_avg: z.string().nullable().optional(),
  preis_ausstehend: z.boolean().optional(),
  total_avg: z.string().nullable().optional(),
  wert_gesamt: z.number().nullable().optional(),
  pnl_prozent: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  from_cache: z.boolean(),
  is_fallback: z.boolean(),
  condition_used: z.string().nullable().optional(),
  no_price: z.boolean(),
  acquisitions: z.array(ValuationAcquisition),
  mixed: z.boolean(),
  /** Nur im Haushalt: Jede Zeile ist der Bestand eines Kontos. */
  owners: z.array(KontoName).optional(),
  error: z.string().nullable().optional(),
});

export const ValuationResponse = z.looseObject({
  kaufpreise_umgerechnet: z.number().int().nullable().optional(),
  guide_type: z.string().nullable().optional(),
  ttl_hours: z.union([z.string(), z.number()]).nullable().optional(),
  success: z.boolean(),
  ...SEITEN_ANGABE,
  total_value: veraltet(z.string(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable(),
  preise_ausstehend: z.number().int().optional(),
  currency: z.string(),
  condition: z.string(),
  ttl_stunden: z.number().int().nullable().optional(),
  kaufpreise_fremde_waehrung: z.number().int(),
  sets: z.array(ValuationSet),
  totals: Totals,
  error: z.string().nullable().optional(),
});

export const routen = {
  'GET /api/v1/sets/:setNumber/price': {
    antwort: SetPriceResponse,
    abfrage: abfrage({
      accounts: Q.konten,
      currency: Q.text(8).meta({
        deprecated: true,
        description: 'wird nicht ausgewertet: Es gilt die Währung des Kontos',
      }),
    }),
  },
  'GET /api/v1/sets/:setNumber/price-history': {
    klein: true,
    antwort: PriceHistoryResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/parts/:partNumber/:colorId/price-history': {
    klein: true,
    antwort: PriceHistoryResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/minifigs/:figNumber/price-history': {
    klein: true,
    antwort: PriceHistoryResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/finance/parts-valuation': {
    antwort: PartsValuationResponse,
    abfrage: abfrage({ accounts: Q.konten, ...SEITE }),
  },
  'GET /api/v1/finance/minifigs-valuation': {
    antwort: FigsValuationResponse,
    abfrage: abfrage({ accounts: Q.konten, ...SEITE }),
  },
  'GET /api/v1/finance/pnl': { antwort: PnlResponse, abfrage: abfrage({ accounts: Q.konten, ...SEITE }) },
  'GET /api/v1/finance/valuation': { antwort: ValuationResponse, abfrage: abfrage({ accounts: Q.konten, ...SEITE }) },
  'GET /api/v1/finance/portfolio-history': {
    klein: true,
    antwort: PortfolioHistoryResponse,
    abfrage: abfrage({ accounts: Q.konten, period: Q.text(20) }),
  },
  'GET /api/v1/stats': { antwort: StatsResponse, abfrage: abfrage({ accounts: Q.konten }) },
} satisfies Record<string, Route>;
