package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.BewertungAnsicht
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.ValuationSetView
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import ch.brickinventoryapp.model.domain.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.domain.GewinnAnsicht
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeileBewertungAnsicht
import java.math.BigDecimal

/**
 * What a card of the finance list shows. The numbers come already rounded from the
 * server (wert_gesamt, pnl_prozent); only purchase times quantity, in money, is computed here.
 */
data class FinanceRow(
    val schluessel: String,
    val menge: Int,
    /** Market value of the row; null = no market price. */
    val wert: Geld?,
    val kaufpreis: Geld?,
    /** State of the entry; null for an item without entries. */
    val zustand: Zustand?,
    val pnlProzent: Double?,
) {
    /**
     * The purchase of all copies of the row. The server delivers the purchase price per copy, but the
     * market value for the whole row (wert_gesamt); placed side by side,
     * „Kauf: 400“ next to „899.90“ with two copies read like a profit of 125 %.
     */
    val kaufGesamt: Geld?
        get() = kaufpreis?.let { it * menge.coerceAtLeast(1) }

    /** Profit or loss in money, on the same basis as [pnlProzent]. */
    val gewinn: Geld?
        get() {
            val w = wert ?: return null
            val k = kaufGesamt ?: return null
            return w - k
        }
}

/**
 * One card per purchase price, as soon as there are several — each with the market price
 * of its own condition. Otherwise one card for the item (the single entry or
 * none).
 */
private fun <T> perPurchasePrice(eintraege: List<T>, entries: (T) -> List<ValuationPurchaseView>) =
    eintraege.flatMap { e ->
        val a = entries(e)
        if (a.size > 1) a.map { e to it } else listOf(e to a.firstOrNull())
    }

fun setRows(sets: List<ValuationSetView>): List<Pair<ValuationSetView, FinanceRow>> =
    perPurchasePrice(sets) { it.acquisitions }.map { (s, acq) ->
        s to FinanceRow(
            schluessel = "${s.setNumber}#${acq?.id ?: 0}",
            menge = acq?.quantity ?: s.quantity,
            wert = acq?.wertGesamt ?: s.wertGesamt,
            kaufpreis = acq?.purchasePrice ?: s.purchasePrice,
            zustand = acq?.condition,
            // With an entry only its own P&L counts: if its purchase price is missing, there is none.
            pnlProzent = if (acq != null) acq.pnlProzent else s.pnlProzent,
        )
    }

internal fun partRows(parts: List<ManualPartView>): List<Pair<ManualPartView, FinanceRow>> =
    perPurchasePrice(parts) { it.acquisitions }.map { (p, acq) ->
        p to FinanceRow("part_${p.id}#${acq?.id ?: 0}", acq?.quantity ?: p.quantity,
            acq?.wertGesamt ?: p.wertGesamt, acq?.purchasePrice ?: p.purchasePrice,
            acq?.condition, acq?.pnlProzent ?: p.pnlProzent)
    }

internal fun minifigRows(figs: List<ManualMinifigView>): List<Pair<ManualMinifigView, FinanceRow>> =
    perPurchasePrice(figs) { it.acquisitions }.map { (f, acq) ->
        f to FinanceRow("fig_${f.id}#${acq?.id ?: 0}", acq?.quantity ?: f.quantity,
            acq?.wertGesamt ?: f.wertGesamt, acq?.purchasePrice ?: f.purchasePrice,
            acq?.condition, acq?.pnlProzent ?: f.pnlProzent)
    }

/** The three subtotals and the total value of the finances page. */
data class FinanceSums(val sets: BigDecimal, val teile: BigDecimal, val figuren: BigDecimal, val gesamt: BigDecimal) {
    val partsAndMinifigs: BigDecimal get() = teile + figuren
}

private fun betrag(text: String?): BigDecimal = text?.trim()?.toBigDecimalOrNull() ?: BigDecimal.ZERO

/**
 * The total value comes from the server (grand_total). If it is missing (older server),
 * the app adds the three server sums — in BigDecimal, because 0.1 + 0.2 as a
 * Double is not 0.3, and otherwise the sum would deviate next to the header tile.
 */
fun finanzSummen(valuation: BewertungAnsicht, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): FinanceSums {
    val sets = betrag(valuation.totals.avg)
    val teile = betrag(parts?.totalValue)
    val figuren = betrag(figs?.totalValue)
    val gesamt = pnl?.totals?.grandTotal?.trim()?.toBigDecimalOrNull() ?: (sets + teile + figuren)
    return FinanceSums(sets, teile, figuren, gesamt)
}

/**
 * How many purchase prices in a different currency are missing. /finance/pnl counts across
 * all three kinds; without this answer, the numbers of the three valuations.
 */
internal fun foreignPurchasePrices(valuation: BewertungAnsicht?, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): Int =
    pnl?.totals?.kaufpreiseFremdeWaehrung
        ?: ((valuation?.kaufpreiseFremdeWaehrung ?: 0) + (parts?.kaufpreiseFremdeWaehrung ?: 0) +
            (figs?.kaufpreiseFremdeWaehrung ?: 0))

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
    val wert: BigDecimal,
    /** null = no P&L (without a basis). */
    val guvAmount: BigDecimal?,
    val guvPercent: Double?,
    val gesamt: Int = 0,
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
internal fun financeHeader(valuation: BewertungAnsicht, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): FinanceHeader {
    val alle = finanzSummen(valuation, parts, figs, pnl).gesamt
    val t = pnl?.totals
    if (t?.basisEinstand == null)
        return FinanceHeader(baseKnown = false, withBase = false, cost = null, wert = alle,
            guvAmount = null, guvPercent = t?.pnlProzent)
    val valued = t.positionenBewertet ?: 0
    val withBase = valued > 0
    return FinanceHeader(
        baseKnown = true,
        withBase = withBase,
        cost = if (withBase) betrag(t.basisEinstand) else t.purchase.trim().toBigDecimalOrNull(),
        wert = if (withBase) betrag(t.basisMarktwert) else alle,
        guvAmount = if (withBase) betrag(t.basisGuvBetrag) else null,
        guvPercent = if (withBase) t.pnlProzent else null,
        gesamt = t.positionen ?: 0,
        valued = valued,
        withoutMarket = t.positionenOhneMarktpreis ?: 0,
        withoutMarketCost = betrag(t.ohneMarktpreisEinstand),
        withoutPurchase = t.positionenOhneKaufpreis ?: 0,
        withoutPurchaseValue = betrag(t.ohneKaufpreisMarktwert),
    )
}
