package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.GainRowView
import ch.brickinventoryapp.model.fach.Geld
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Betrag und G&V eines Sets für die Galeriekachel. [quelle] ist kachel_quelle des
 * Servers ("markt"/"kauf"): Ohne Marktpreis liefert er den Kaufpreis als Betrag.
 */
data class TilePrice(val betrag: Geld?, val pnlPct: Double?, val quelle: String? = null)

/** Was der Betrag der Kachel ist — die Beschriftung darüber nennt es wie im Web. */
internal enum class TileSource { MARKT, PURCHASE }

/**
 * Je Set eine Angabe aus /finance/pnl. Betrag und G&V rechnet der Server
 * (kachel_preis, kachel_pnl_pct) — dieselbe Zahl wie im Web, auch im Haushalt.
 */
internal fun tilePrices(zeilen: List<GainRowView>): Map<String, TilePrice> =
    zeilen.groupBy { it.setNumber }.mapValues { (_, z) ->
        val e = z[0]
        if (e.kachelPreis != null || e.kachelPnlPct != null) TilePrice(e.kachelPreis, e.kachelPnlPct, e.kachelQuelle)
        else tilePriceBeforeServer(z)
    }

/**
 * ÜBERGANG für Server vor 36d27a9 ohne kachel_*: die frühere Rechnung der App.
 * Liefert ein neuer Server beide Felder als null (kein Preis), ergibt sie
 * ebenfalls null. Entfällt, sobald kein älterer Server mehr im Einsatz ist.
 */
private fun tilePriceBeforeServer(z: List<GainRowView>): TilePrice {
    if (z.size == 1) {
        val e = z[0]
        return TilePrice(e.currentPrice, (e.baselinePnlPct ?: e.pnlPct)?.toDoubleOrNull())
    }
    // Gewichteter Basispreis in BigDecimal: Er ist ein Geldbetrag, den die App selbst bildet.
    val withBase = z.filter { it.baselinePrice != null }
    val menge = withBase.sumOf { it.quantity.coerceAtLeast(1) }
    val basis = if (menge > 0) withBase.fold(BigDecimal.ZERO) { s, zeile ->
        s + zeile.baselinePrice!!.asBigDecimal() * BigDecimal(zeile.quantity.coerceAtLeast(1))
    }.divide(BigDecimal(menge), 10, RoundingMode.HALF_UP) else null
    val markt = (z[0].currentPrice ?: Geld.NULL).asBigDecimal()
    // 0.01 wie PNL_EPS auf dem Server: Ein Kaufpreis von 0 teilt sonst durch null.
    val pct = if (basis != null && markt.signum() > 0)
        (markt - basis).multiply(BigDecimal(100)).divide(basis.max(BigDecimal("0.01")), 1, RoundingMode.HALF_UP)
    else null
    return TilePrice(z[0].currentPrice, pct?.toDouble())
}

/** Der Betrag auf der Kachel: der des Servers, sonst der mengengewichtete Kaufpreis des Sets. */
internal fun tileAmount(set: SetAnsicht, preis: TilePrice?): Geld? =
    preis?.betrag?.takeIf { it.positive } ?: set.avgPurchasePrice ?: set.maxPurchasePrice

/**
 * Woher [tileAmount] stammt. Ein Betrag des Servers ist Marktpreis, ausser er
 * sagt "kauf"; ältere Server ohne kachel_quelle lieferten nur Marktpreise. Ohne
 * ihn steht der eigene Kaufpreis da, ohne beides nichts.
 */
internal fun kachelQuelle(set: SetAnsicht, preis: TilePrice?): TileSource? {
    val betrag = preis?.betrag
    if (preis != null && betrag != null && betrag.positive)
        return if (preis.quelle == "kauf") TileSource.PURCHASE else TileSource.MARKT
    return if (set.avgPurchasePrice != null || set.maxPurchasePrice != null) TileSource.PURCHASE else null
}
