import { moneyInput } from '../infra/geld';
import type { FinancesContext } from './context';

/** For parts and figures in one place; empty means "take the market price", not "price zero".
 * @param marktpreis at the caller, because part and figure have different keys. */
export async function purchasePriceFromInput(
  k: FinancesContext,
  raw: unknown,
  stateRaw: unknown,
  stateNow: string | null | undefined,
  userId: number,
  marktpreis: (zustand: string) => Promise<number | null>,
): Promise<{ unitPrice: number | null; purchasePrice: number | null }> {
  const zahl = moneyInput(raw, 'Preis');
  if (zahl !== null) return { unitPrice: zahl, purchasePrice: zahl };
  const zustand = await k.einstellungen.conditionForPrice(stateRaw, stateNow, userId);
  return { unitPrice: null, purchasePrice: await marktpreis(zustand) };
}

/** Without a market price the master row holds 0, the acquisition NULL — the same for
 * parts and figures. */
export async function manualPurchasePrice(
  k: FinancesContext,
  userId: number,
  input: { unitPrice?: unknown; condition?: string | null },
  marktpreis: (zustand: string) => Promise<{ preis: number | null; fromState: string | null }>,
): Promise<{
  unitPrice: number | null;
  /** For the MASTER ROW — never null. */
  kaufpreis: number;
  /** For the ACQUISITION — null if no price is known. */
  erfassungsPreis: number | null;
  zustand: string;
  /** Only set if the market price was adopted from the OTHER condition. */
  priceFromState: string | null;
  geschaetzt: boolean;
}> {
  const unitPrice = moneyInput(input.unitPrice, 'Stückpreis');

  const zustand = await k.einstellungen.conditionForPrice(input.condition ?? null, null, userId);

  // A typed-in price does not ask the market — no origin to mark.
  const market = unitPrice !== null ? null : await marktpreis(zustand);
  const kaufpreis = unitPrice !== null ? unitPrice : (market?.preis ?? 0);
  return {
    unitPrice,
    kaufpreis,
    erfassungsPreis: kaufpreis > 0 ? kaufpreis : null,
    zustand,
    // An origin without a value would be a hint at something that is nowhere to be found.
    priceFromState: kaufpreis > 0 && market?.fromState ? market.fromState : null,
    geschaetzt: unitPrice === null && kaufpreis > 0,
  };
}
