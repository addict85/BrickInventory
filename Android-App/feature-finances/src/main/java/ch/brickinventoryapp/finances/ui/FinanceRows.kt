package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FiguresValuationView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PartsValuationView
import ch.brickinventoryapp.model.domain.ProfitView
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import ch.brickinventoryapp.model.domain.ValuationSetView
import ch.brickinventoryapp.model.domain.ValuationView
import java.math.BigDecimal

/**
 * What a card of the finance list shows. The numbers come already rounded from the
 * server (wert_gesamt, pnl_prozent); only purchase times quantity, in money, is computed here.
 */
data class FinanceRow(
    val key: String,
    val quantity: Int,
    /** Market value of the row; null = no market price. */
    val value: Money?,
    val purchasePrice: Money?,
    /** State of the entry; null for an item without entries. */
    val condition: Condition?,
    val pnlPercent: Double?,
) {
    /**
     * The purchase of all copies of the row. The server delivers the purchase price per copy, but the
     * market value for the whole row (wert_gesamt); placed side by side,
     * „Kauf: 400“ next to „899.90“ with two copies read like a profit of 125 %.
     */
    val purchaseTotal: Money?
        get() = purchasePrice?.let { it * quantity.coerceAtLeast(1) }

    /** Profit or loss in money, on the same basis as [pnlPercent]. */
    val profit: Money?
        get() {
            val w = value ?: return null
            val k = purchaseTotal ?: return null
            return w - k
        }
}

/**
 * One card per purchase price, as soon as there are several — each with the market price
 * of its own condition. Otherwise one card for the item (the single entry or
 * none).
 */
private fun <T> perPurchasePrice(items: List<T>, entries: (T) -> List<ValuationPurchaseView>) =
    items.flatMap { e ->
        val a = entries(e)
        if (a.size > 1) a.map { e to it } else listOf(e to a.firstOrNull())
    }

fun setRows(sets: List<ValuationSetView>): List<Pair<ValuationSetView, FinanceRow>> =
    perPurchasePrice(sets) { it.acquisitions }.map { (s, acq) ->
        s to FinanceRow(
            key = "${s.setNumber}#${acq?.id ?: 0}",
            quantity = acq?.quantity ?: s.quantity,
            value = acq?.valueTotal ?: s.valueTotal,
            purchasePrice = acq?.purchasePrice ?: s.purchasePrice,
            condition = acq?.condition,
            // With an entry only its own P&L counts: if its purchase price is missing, there is none.
            pnlPercent = if (acq != null) acq.pnlPercent else s.pnlPercent,
        )
    }

internal fun partRows(parts: List<ManualPartView>): List<Pair<ManualPartView, FinanceRow>> =
    perPurchasePrice(parts) { it.acquisitions }.map { (p, acq) ->
        p to FinanceRow("part_${p.id}#${acq?.id ?: 0}", acq?.quantity ?: p.quantity,
            acq?.valueTotal ?: p.valueTotal, acq?.purchasePrice ?: p.purchasePrice,
            acq?.condition, acq?.pnlPercent ?: p.pnlPercent)
    }

internal fun minifigRows(figs: List<ManualMinifigView>): List<Pair<ManualMinifigView, FinanceRow>> =
    perPurchasePrice(figs) { it.acquisitions }.map { (f, acq) ->
        f to FinanceRow("fig_${f.id}#${acq?.id ?: 0}", acq?.quantity ?: f.quantity,
            acq?.valueTotal ?: f.valueTotal, acq?.purchasePrice ?: f.purchasePrice,
            acq?.condition, acq?.pnlPercent ?: f.pnlPercent)
    }

/** The three subtotals and the total value of the finances page. */
data class FinanceSums(val sets: BigDecimal, val parts: BigDecimal, val figures: BigDecimal, val total: BigDecimal) {
    val partsAndMinifigs: BigDecimal get() = parts + figures
}

private fun amount(text: String?): BigDecimal = text?.trim()?.toBigDecimalOrNull() ?: BigDecimal.ZERO

/**
 * The total value comes from the server (grand_total). If it is missing (older server),
 * the app adds the three server sums — in BigDecimal, because 0.1 + 0.2 as a
 * Double is not 0.3, and otherwise the sum would deviate next to the header tile.
 */
fun financeTotals(valuation: ValuationView, parts: PartsValuationView?, figs: FiguresValuationView?, pnl: ProfitView?): FinanceSums {
    val sets = amount(valuation.totals.avg)
    val parts = amount(parts?.totalValue)
    val figures = amount(figs?.totalValue)
    val total = pnl?.totals?.grandTotal?.trim()?.toBigDecimalOrNull() ?: (sets + parts + figures)
    return FinanceSums(sets, parts, figures, total)
}

/**
 * How many purchase prices in a different currency are missing. /finance/pnl counts across
 * all three kinds; without this answer, the numbers of the three valuations.
 */
internal fun foreignPurchasePrices(valuation: ValuationView?, parts: PartsValuationView?, figs: FiguresValuationView?, pnl: ProfitView?): Int =
    pnl?.totals?.purchasePricesForeignCurrency
        ?: ((valuation?.purchasePricesForeignCurrency ?: 0) + (parts?.purchasePricesForeignCurrency ?: 0) +
            (figs?.purchasePricesForeignCurrency ?: 0))

/**
 * What the header card shows. [withBase]: the server computed positions with BOTH purchase AND
 * market price; then cost basis, market value and P&L come from this one
 * basis, so that cost basis + P&L = market value holds (as on the web, basisAus).
 * [baseKnown] is false on older servers without these fields.
 */
internal data class FinanceHeader(
    val baseKnown: Boolean,
    val withBase: Boolean,
    /** null = not known (older server). */
    val cost: BigDecimal?,
    val value: BigDecimal,
    /** null = no P&L (without a basis). */
    val pnlAmount: BigDecimal?,
    val pnlPercent: Double?,
    val total: Int = 0,
    val valued: Int = 0,
    val withoutMarket: Int = 0,
    val withoutMarketCost: BigDecimal = BigDecimal.ZERO,
    val withoutPurchase: Int = 0,
    val withoutPurchaseValue: BigDecimal = BigDecimal.ZERO,
) {
    /** The basis row only appears when computed and something is missing — otherwise it says nothing. */
    val baseRowVisible: Boolean get() = withBase && (withoutMarket > 0 || withoutPurchase > 0)
}

/**
 * Without basis fields (older server) the card stays as it was: total value and
 * pnl_prozent. With a basis, but without a valued position, the sums of all
 * positions stand there and no P&L — a percentage against nothing would be made up.
 */
internal fun financeHeader(valuation: ValuationView, parts: PartsValuationView?, figs: FiguresValuationView?, pnl: ProfitView?): FinanceHeader {
    val all = financeTotals(valuation, parts, figs, pnl).total
    val t = pnl?.totals
    if (t?.basisCostBasis == null)
        return FinanceHeader(baseKnown = false, withBase = false, cost = null, value = all,
            pnlAmount = null, pnlPercent = t?.pnlPercent)
    val valued = t.positionsValued ?: 0
    val withBase = valued > 0
    return FinanceHeader(
        baseKnown = true,
        withBase = withBase,
        cost = if (withBase) amount(t.basisCostBasis) else t.purchase.trim().toBigDecimalOrNull(),
        value = if (withBase) amount(t.basisMarketValue) else all,
        pnlAmount = if (withBase) amount(t.basisPnlAmount) else null,
        pnlPercent = if (withBase) t.pnlPercent else null,
        total = t.positions ?: 0,
        valued = valued,
        withoutMarket = t.positionsWithoutMarketPrice ?: 0,
        withoutMarketCost = amount(t.withoutMarketPriceCostBasis),
        withoutPurchase = t.positionsWithoutPurchasePrice ?: 0,
        withoutPurchaseValue = amount(t.withoutPurchasePriceMarketValue),
    )
}
