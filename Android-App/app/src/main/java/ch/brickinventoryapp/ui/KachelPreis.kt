package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.PnlSetZeile
import ch.brickinventoryapp.data.model.SetItem
import java.math.BigDecimal
import java.math.RoundingMode

/** Betrag und G&V eines Sets für die Galeriekachel. */
data class KachelPreis(val betrag: Double?, val pnlPct: Double?)

/**
 * Je Set eine Angabe aus /finance/pnl. Betrag und G&V rechnet der Server
 * (kachel_preis, kachel_pnl_pct) — dieselbe Zahl wie im Web, auch im Haushalt.
 */
fun kachelPreise(zeilen: List<PnlSetZeile>): Map<String, KachelPreis> =
    zeilen.groupBy { it.setNumber }.mapValues { (_, z) ->
        val e = z[0]
        if (e.kachelPreis != null || e.kachelPnlPct != null) KachelPreis(e.kachelPreis, e.kachelPnlPct)
        else kachelPreisVorServer(z)
    }

/**
 * ÜBERGANG für Server vor 36d27a9 ohne kachel_*: die frühere Rechnung der App.
 * Liefert ein neuer Server beide Felder als null (kein Preis), ergibt sie
 * ebenfalls null. Entfällt, sobald kein älterer Server mehr im Einsatz ist.
 */
private fun kachelPreisVorServer(z: List<PnlSetZeile>): KachelPreis {
    if (z.size == 1) {
        val e = z[0]
        return KachelPreis(e.currentPrice, (e.baselinePnlPct ?: e.pnlPct)?.toDoubleOrNull())
    }
    // Gewichteter Basispreis in BigDecimal: Er ist ein Geldbetrag, den die App selbst bildet.
    val mitBasis = z.filter { it.baselinePrice != null }
    val menge = mitBasis.sumOf { it.quantity.coerceAtLeast(1) }
    val basis = if (menge > 0) mitBasis.fold(BigDecimal.ZERO) { s, it ->
        s + BigDecimal.valueOf(it.baselinePrice!!) * BigDecimal(it.quantity.coerceAtLeast(1))
    }.divide(BigDecimal(menge), 10, RoundingMode.HALF_UP) else null
    val markt = BigDecimal.valueOf(z[0].currentPrice ?: 0.0)
    // 0.01 wie PNL_EPS auf dem Server: Ein Kaufpreis von 0 teilt sonst durch null.
    val pct = if (basis != null && markt.signum() > 0)
        (markt - basis).multiply(BigDecimal(100)).divide(basis.max(BigDecimal("0.01")), 1, RoundingMode.HALF_UP)
    else null
    return KachelPreis(z[0].currentPrice, pct?.toDouble())
}

/** Der Betrag auf der Kachel: der des Servers, sonst der mengengewichtete Kaufpreis des Sets. */
fun kachelBetrag(set: SetItem, preis: KachelPreis?): Double? =
    preis?.betrag?.takeIf { it > 0 } ?: set.avgPurchasePrice ?: set.maxPurchasePrice
