package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.GainRowView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetView
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Amount and P&L of a set for the gallery tile. [source] is the server's
 * kachel_quelle ("markt"/"kauf"): without a market price it delivers the purchase price as the amount.
 */
data class TilePrice(val amount: Money?, val pnlPct: Double?, val source: String? = null)

/** What the tile's amount is — the label above it names it as in the web. */
internal enum class TileSource { MARKET, PURCHASE }

/**
 * One value per set from /finance/pnl. The server calculates amount and P&L
 * (kachel_preis, kachel_pnl_pct) — the same number as in the web, in the household too.
 */
internal fun tilePrices(rows: List<GainRowView>): Map<String, TilePrice> =
    rows.groupBy { it.setNumber }.mapValues { (_, z) ->
        val e = z[0]
        if (e.tilePrice != null || e.tilePnlPct != null) TilePrice(e.tilePrice, e.tilePnlPct, e.tileSource)
        else tilePriceBeforeServer(z)
    }

/**
 * TRANSITION for servers before 36d27a9 without kachel_*: the app's earlier calculation.
 * If a new server delivers both fields as null (no price), it also
 * gives null. Drops out once no older server is in use anymore.
 */
private fun tilePriceBeforeServer(z: List<GainRowView>): TilePrice {
    if (z.size == 1) {
        val e = z[0]
        return TilePrice(e.currentPrice, (e.baselinePnlPct ?: e.pnlPct)?.toDoubleOrNull())
    }
    // Weighted base price in BigDecimal: it's an amount of money the app forms itself.
    val withBase = z.filter { it.baselinePrice != null }
    val quantity = withBase.sumOf { it.quantity.coerceAtLeast(1) }
    val basis = if (quantity > 0) withBase.fold(BigDecimal.ZERO) { s, row ->
        s + row.baselinePrice!!.asBigDecimal() * BigDecimal(row.quantity.coerceAtLeast(1))
    }.divide(BigDecimal(quantity), 10, RoundingMode.HALF_UP) else null
    val market = (z[0].currentPrice ?: Money.NULL).asBigDecimal()
    // 0.01 like PNL_EPS on the server: a purchase price of 0 would otherwise divide by zero.
    val pct = if (basis != null && market.signum() > 0)
        (market - basis).multiply(BigDecimal(100)).divide(basis.max(BigDecimal("0.01")), 1, RoundingMode.HALF_UP)
    else null
    return TilePrice(z[0].currentPrice, pct?.toDouble())
}

/** The tile's amount: the server's, otherwise the set's quantity-weighted purchase price. */
internal fun tileAmount(set: SetView, price: TilePrice?): Money? =
    price?.amount?.takeIf { it.positive } ?: set.avgPurchasePrice ?: set.maxPurchasePrice

/**
 * Where [tileAmount] comes from. A server amount is a market price unless it
 * says "kauf"; older servers without kachel_quelle only delivered market prices. Without
 * it, one's own purchase price stands there, without both, nothing.
 */
internal fun tileSource(set: SetView, price: TilePrice?): TileSource? {
    val amount = price?.amount
    if (price != null && amount != null && amount.positive)
        return if (price.source == "kauf") TileSource.PURCHASE else TileSource.MARKET
    return if (set.avgPurchasePrice != null || set.maxPurchasePrice != null) TileSource.PURCHASE else null
}
