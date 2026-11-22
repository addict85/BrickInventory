import { z } from 'zod';
import { V1_TILE_SOURCES } from './v1Names';
import { v1Keys, v1Values } from './v1';
import { type Route, AccountName, time, query, Q, outdated, PERCENT_TEXT, PAGE, PAGES_DETAIL } from './base';
import { FigValuationItem, PartValuationItem, ValuationAcquisition } from './shared';

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
  market_price: z.number().nullable(),
  purchase_price: z.number().nullable(),
  pnl_pct: PERCENT_TEXT,
  pnl_percent: z.number().nullable(),
});

export const DashboardStats = z.looseObject({
  currency: z.string(),
  default_condition: z.string(),
  user_default_condition: z.string().nullable(),
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
  converted_purchase_prices: z.number().int(),
  success: z.boolean(),
  ...PAGES_DETAIL,
  currency: z.string(),
  figs: z.array(FigValuationItem),
  total_value: outdated(z.string(), 'value_total'),
  value_total: z.number().nullable(),
  prices_pending: z.number().int(),
  foreign_currency_purchases: z.number().int(),
});

export const PartsValuationResponse = z.looseObject({
  converted_purchase_prices: z.number().int(),
  success: z.boolean(),
  ...PAGES_DETAIL,
  currency: z.string(),
  parts: z.array(PartValuationItem),
  total_value: outdated(z.string(), 'value_total'),
  value_total: z.number().nullable(),
  prices_pending: z.number().int(),
  foreign_currency_purchases: z.number().int(),
});

export const PnlTotals = z.looseObject({
  converted_purchase_prices: z.number().int(),
  pnl_current: z.union([z.string(), z.number()]).nullable(),
  pnl_purchase: z.union([z.string(), z.number()]).nullable(),
  purchase: z.string(),
  current: z.string(),
  pnl_pct: PERCENT_TEXT,
  pnl_percent: z.number().nullable(),
  foreign_currency_purchases: z.number().int(),
  sets_purchase: z.string(),
  parts_purchase: z.string(),
  figs_purchase: z.string(),
  grand_total: z.string(),
  positions: z.number().int().optional(),
  positions_valued: z.number().int().optional(),
  positions_without_market_price: z.number().int().optional(),
  positions_without_purchase_price: z.number().int().optional(),
  baseline_cost: z.string().optional(),
  baseline_market_value: z.string().optional(),
  baseline_pnl_amount: z.string().optional(),
  cost_without_market_price: z.string().optional(),
  market_value_without_purchase_price: z.string().optional(),
});

export const PnlSetRow = z.looseObject({
  added_at: time.nullable(),
  condition: z.string(),
  image_local: z.string().nullable(),
  image_url: z.string().nullable(),
  name: z.string().nullable(),
  pnl_abs: z.string().nullable(),
  purchase_price: z.number().nullable(),
  year: z.number().int().nullable(),
  set_number: z.string(),
  quantity: z.number().int(),
  current_price: z.number().nullable(),
  baseline_price: z.number().nullable(),
  pnl_pct: PERCENT_TEXT,
  baseline_pnl_pct: outdated(z.string().nullable().optional(), 'baseline_pnl_percent'),
  pnl_amount: z.number().nullable(),
  pnl_percent: z.number().nullable(),
  baseline_pnl_percent: z.number().nullable(),
  tile_price: z.number().nullable().optional(),
  tile_pnl_pct: z.number().nullable().optional(),
  tile_source: v1Values(z.enum(['market', 'purchase']), V1_TILE_SOURCES)
    .nullable()
    .optional(),
});

export const PnlResponse = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  currency: z.string(),
  totals: PnlTotals,
  sets: z.array(PnlSetRow),
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
  data_points: z.number().int().nullable(),
  success: z.boolean(),
  currency: z.string(),
  period: z.string(),
  points: z.array(ChartPoint),
  y_axis: z.array(ChartYAxis),
  period_change_pct: z.number().nullable(),
  purchase_total: z.string().nullable().optional(),
});

export const PriceHistoryPoint = z.looseObject({
  is_purchase_price: z.boolean().optional(),
  recorded_at: time,
  qty_avg_price: z.number().nullable(),
  avg_price: z.number().nullable(),
  min_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
});

export const PriceHistoryResponse = z.looseObject({
  condition: z.string().nullable().optional(),
  current: z.unknown().optional(),
  success: z.boolean(),
  /** Only for the set. */
  set_number: z.string().optional(),
  currency: z.string(),
  history_new: z.array(PriceHistoryPoint),
  history_used: z.array(PriceHistoryPoint),
  by_condition: PriceByCondition,
  chart: PriceChartData,
  pnl_pct: PERCENT_TEXT,
  pnl_percent: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
});

export const SetPriceResponse = z.looseObject({
  from_cache: z.boolean().optional(),
  success: z.boolean(),
  set_number: z.string(),
  currency: z.string(),
  avg_price: z.number().nullable(),
  min_price: z.number().nullable(),
  max_price: z.number().nullable(),
  qty_avg_price: z.number().nullable(),
  no_price: z.boolean(),
  /** Why no price came (setPrice); then no_price is set. */
  error: z.string().optional(),
});

export const StatsResponse = z.looseObject({
  success: z.boolean(),
  stats: DashboardStats.nullable(),
});

export const Totals = z.looseObject({
  min: z.string(),
  avg: z.string(),
  max: z.string(),
  qty_avg: z.string(),
});

export const ValuationSet = z.looseObject({
  bl_unknown: z.boolean(),
  condition: z.string(),
  conditions: z.array(z.string()),
  error_code: z.string().nullable().optional(),
  pnl_pct: PERCENT_TEXT,
  user_id: z.number().int(),
  set_number: z.string(),
  added_at: time.nullable(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  quantity: z.number().int(),
  image_local: z.string().nullable(),
  image_url: z.string().nullable(),
  min_price: z.number().nullable(),
  avg_price: z.number().nullable(),
  max_price: z.number().nullable(),
  qty_avg_price: z.number().nullable(),
  total_qty_avg: z.string().nullable(),
  price_pending: z.boolean(),
  total_avg: z.string().nullable(),
  value_total: z.number().nullable(),
  pnl_percent: z.number().nullable(),
  purchase_price: z.number().nullable(),
  from_cache: z.boolean(),
  is_fallback: z.boolean(),
  condition_used: z.string().nullable().optional(),
  no_price: z.boolean(),
  acquisitions: z.array(ValuationAcquisition),
  mixed: z.boolean(),
  /** Only in the household: every row is one account's inventory. */
  owners: z.array(AccountName).optional(),
  error: z.string().nullable().optional(),
});

export const ValuationResponse = z.looseObject({
  converted_purchase_prices: z.number().int(),
  guide_type: z.string(),
  ttl_hours: z.union([z.string(), z.number()]).nullable(),
  success: z.boolean(),
  ...PAGES_DETAIL,
  total_value: outdated(z.string(), 'value_total'),
  value_total: z.number().nullable(),
  prices_pending: z.number().int(),
  currency: z.string(),
  condition: z.string(),
  cache_ttl_hours: z.number().int(),
  foreign_currency_purchases: z.number().int(),
  sets: z.array(ValuationSet),
  totals: Totals,
});

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(FigsValuationResponse.shape.figs.element, { pending: 'ausstehend' });
v1Keys(PartsValuationResponse.shape.parts.element, { pending: 'ausstehend' });

export const routes = {
  'GET /api/v2/sets/:setNumber/price': {
    response: SetPriceResponse,
    query: query({
      accounts: Q.accounts,
      currency: Q.text(8).meta({
        deprecated: true,
        description: 'not evaluated: the account currency applies',
      }),
    }),
  },
  'GET /api/v2/sets/:setNumber/price-history': {
    small: true,
    response: PriceHistoryResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/parts/:partNumber/:colorId/price-history': {
    small: true,
    response: PriceHistoryResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/minifigs/:figNumber/price-history': {
    small: true,
    response: PriceHistoryResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/finance/parts-valuation': {
    response: PartsValuationResponse,
    query: query({ accounts: Q.accounts, ...PAGE }),
  },
  'GET /api/v2/finance/minifigs-valuation': {
    response: FigsValuationResponse,
    query: query({ accounts: Q.accounts, ...PAGE }),
  },
  'GET /api/v2/finance/pnl': { response: PnlResponse, query: query({ accounts: Q.accounts, ...PAGE }) },
  'GET /api/v2/finance/valuation': { response: ValuationResponse, query: query({ accounts: Q.accounts, ...PAGE }) },
  'GET /api/v2/finance/portfolio-history': {
    small: true,
    response: PortfolioHistoryResponse,
    query: query({ accounts: Q.accounts, period: Q.text(20) }),
  },
  'GET /api/v2/stats': { response: StatsResponse, query: query({ accounts: Q.accounts }) },
} satisfies Record<string, Route>;
