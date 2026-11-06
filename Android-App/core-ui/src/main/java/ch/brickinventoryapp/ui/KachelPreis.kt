package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.model.SetAnsicht
import ch.brickinventoryapp.data.model.PnlSetZeile
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Betrag und G&V eines Sets für die Galeriekachel. [quelle] ist kachel_quelle des
 * Servers ("markt"/"kauf"): Ohne Marktpreis liefert er den Kaufpreis als Betrag.
 */
data class KachelPreis(val betrag: Double?, val pnlPct: Double?, val quelle: String? = null)

/** Was der Betrag der Kachel ist — die Beschriftung darüber nennt es wie im Web. */
enum class KachelQuelle { MARKT, KAUF }

/**
 * Je Set eine Angabe aus /finance/pnl. Betrag und G&V rechnet der Server
 * (kachel_preis, kachel_pnl_pct) — dieselbe Zahl wie im Web, auch im Haushalt.
 */
fun kachelPreise(zeilen: List<PnlSetZeile>): Map<String, KachelPreis> =
    zeilen.groupBy { it.setNumber }.mapValues { (_, z) ->
        val e = z[0]
        if (e.kachelPreis != null || e.kachelPnlPct != null) KachelPreis(e.kachelPreis, e.kachelPnlPct, e.kachelQuelle)
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
    val basis = if (menge > 0) mitBasis.fold(BigDecimal.ZERO) { s, zeile ->
        s + BigDecimal.valueOf(zeile.baselinePrice!!) * BigDecimal(zeile.quantity.coerceAtLeast(1))
    }.divide(BigDecimal(menge), 10, RoundingMode.HALF_UP) else null
    val markt = BigDecimal.valueOf(z[0].currentPrice ?: 0.0)
    // 0.01 wie PNL_EPS auf dem Server: Ein Kaufpreis von 0 teilt sonst durch null.
    val pct = if (basis != null && markt.signum() > 0)
        (markt - basis).multiply(BigDecimal(100)).divide(basis.max(BigDecimal("0.01")), 1, RoundingMode.HALF_UP)
    else null
    return KachelPreis(z[0].currentPrice, pct?.toDouble())
}

/** Der Betrag auf der Kachel: der des Servers, sonst der mengengewichtete Kaufpreis des Sets. */
fun kachelBetrag(set: SetAnsicht, preis: KachelPreis?): Double? =
    preis?.betrag?.takeIf { it > 0 } ?: set.avgPurchasePrice ?: set.maxPurchasePrice

/**
 * Woher [kachelBetrag] stammt. Ein Betrag des Servers ist Marktpreis, ausser er
 * sagt "kauf"; ältere Server ohne kachel_quelle lieferten nur Marktpreise. Ohne
 * ihn steht der eigene Kaufpreis da, ohne beides nichts.
 */
fun kachelQuelle(set: SetAnsicht, preis: KachelPreis?): KachelQuelle? {
    val betrag = preis?.betrag
    if (preis != null && betrag != null && betrag > 0)
        return if (preis.quelle == "kauf") KachelQuelle.KAUF else KachelQuelle.MARKT
    return if (set.avgPurchasePrice != null || set.maxPurchasePrice != null) KachelQuelle.KAUF else null
}
