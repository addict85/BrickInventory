package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.GainRowView
import ch.brickinventoryapp.model.domain.Geld
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Amount and P&L of a set for the gallery tile. [quelle] is the server's
 * kachel_quelle ("markt"/"kauf"): without a market price it delivers the purchase price as the amount.
 */
data class TilePrice(val betrag: Geld?, val pnlPct: Double?, val quelle: String? = null)

/** What the tile's amount is — the label above it names it as in the web. */
internal enum class TileSource { MARKT, PURCHASE }

/**
 * One value per set from /finance/pnl. The server calculates amount and P&L
 * (kachel_preis, kachel_pnl_pct) — the same number as in the web, in the household too.
 */
internal fun tilePrices(zeilen: List<GainRowView>): Map<String, TilePrice> =
    zeilen.groupBy { it.setNumber }.mapValues { (_, z) ->
        val e = z[0]
        if (e.kachelPreis != null || e.kachelPnlPct != null) TilePrice(e.kachelPreis, e.kachelPnlPct, e.kachelQuelle)
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
    val menge = withBase.sumOf { it.quantity.coerceAtLeast(1) }
    val basis = if (menge > 0) withBase.fold(BigDecimal.ZERO) { s, zeile ->
        s + zeile.baselinePrice!!.asBigDecimal() * BigDecimal(zeile.quantity.coerceAtLeast(1))
    }.divide(BigDecimal(menge), 10, RoundingMode.HALF_UP) else null
    val markt = (z[0].currentPrice ?: Geld.NULL).asBigDecimal()
    // 0.01 like PNL_EPS on the server: a purchase price of 0 would otherwise divide by zero.
    val pct = if (basis != null && markt.signum() > 0)
        (markt - basis).multiply(BigDecimal(100)).divide(basis.max(BigDecimal("0.01")), 1, RoundingMode.HALF_UP)
    else null
    return TilePrice(z[0].currentPrice, pct?.toDouble())
}

/** The tile's amount: the server's, otherwise the set's quantity-weighted purchase price. */
internal fun tileAmount(set: SetAnsicht, preis: TilePrice?): Geld? =
    preis?.betrag?.takeIf { it.positive } ?: set.avgPurchasePrice ?: set.maxPurchasePrice

/**
 * Where [tileAmount] comes from. A server amount is a market price unless it
 * says "kauf"; older servers without kachel_quelle only delivered market prices. Without
 * it, one's own purchase price stands there, without both, nothing.
 */
internal fun kachelQuelle(set: SetAnsicht, preis: TilePrice?): TileSource? {
    val betrag = preis?.betrag
    if (preis != null && betrag != null && betrag.positive)
        return if (preis.quelle == "kauf") TileSource.PURCHASE else TileSource.MARKT
    return if (set.avgPurchasePrice != null || set.maxPurchasePrice != null) TileSource.PURCHASE else null
}
