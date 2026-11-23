import { moneyInput } from '../infra/money';
import type { FinancesContext } from './context';

/** For parts and figures in one place; empty means "take the market price", not "price zero".
 * @param marketPrice at the caller, because part and figure have different keys. */
export async function purchasePriceFromInput(
  k: FinancesContext,
  raw: unknown,
  stateRaw: unknown,
  stateNow: string | null | undefined,
  userId: number,
  marketPrice: (condition: string) => Promise<number | null>,
): Promise<{ unitPrice: number | null; purchasePrice: number | null }> {
  const number = moneyInput(raw, 'Preis');
  if (number !== null) return { unitPrice: number, purchasePrice: number };
  const condition = await k.settings.conditionForPrice(stateRaw, stateNow, userId);
  return { unitPrice: null, purchasePrice: await marketPrice(condition) };
}

/** Without a market price the master row holds 0, the acquisition NULL — the same for
 * parts and figures. */
export async function manualPurchasePrice(
  k: FinancesContext,
  userId: number,
  input: { unitPrice?: unknown; condition?: string | null },
  marketPrice: (condition: string) => Promise<{ price: number | null; fromState: string | null }>,
): Promise<{
  unitPrice: number | null;
  /** For the MASTER ROW — never null. */
  purchasePrice: number;
  /** For the ACQUISITION — null if no price is known. */
  acquisitionPrice: number | null;
  condition: string;
  /** Only set if the market price was adopted from the OTHER condition. */
  priceFromState: string | null;
  estimated: boolean;
}> {
  const unitPrice = moneyInput(input.unitPrice, 'Stückpreis');

  const condition = await k.settings.conditionForPrice(input.condition ?? null, null, userId);

  // A typed-in price does not ask the market — no origin to mark.
  const market = unitPrice !== null ? null : await marketPrice(condition);
  const purchasePrice = unitPrice !== null ? unitPrice : (market?.price ?? 0);
  return {
    unitPrice,
    purchasePrice,
    acquisitionPrice: purchasePrice > 0 ? purchasePrice : null,
    condition,
    // An origin without a value would be a hint at something that is nowhere to be found.
    priceFromState: purchasePrice > 0 && market?.fromState ? market.fromState : null,
    estimated: unitPrice === null && purchasePrice > 0,
  };
}
