package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.GainRowView
import ch.brickinventoryapp.model.domain.Money
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Amount and P&L of a set for the gallery tile. [source] is the server's
 * tile_source ("market"/"purchase"): without a market price it delivers the purchase price as the amount.
 */
data class TilePrice(val amount: Money?, val pnlPct: Double?, val source: String? = null)

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

/**
 * The tile's amount: always the market price, never the purchase price. Tiles that
 * switched silently between both made neighbors incomparable; the server marks its
 * purchase-price fallback with source "purchase", older servers sent market prices only.
 */
internal fun tileMarketPrice(price: TilePrice?): Money? =
    price?.takeIf { it.source != "purchase" }?.amount?.takeIf { it.positive }
