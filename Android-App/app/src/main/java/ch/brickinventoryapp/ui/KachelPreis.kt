package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.PnlSetZeile
import ch.brickinventoryapp.data.model.SetItem

/** Marktpreis und G&V eines Sets für die Galeriekachel. */
data class KachelPreis(val marktpreis: Double?, val pnlPct: Double?)

/**
 * Je Set eine Angabe aus den Zeilen von /finance/pnl — dieselbe Rechnung wie
 * die Galerie im Web (public/js/07-admin.js). Ein Set kann mehrere Zeilen
 * haben (je Zustand); dann zählt der nach Menge gewichtete Basispreis, weil
 * „irgendeine Zeile“ je nach Reihenfolge eine andere Prozentzahl ergäbe.
 */
fun kachelPreise(zeilen: List<PnlSetZeile>): Map<String, KachelPreis> =
    zeilen.groupBy { it.setNumber }.mapValues { (_, z) ->
        if (z.size == 1) {
            val e = z[0]
            KachelPreis(e.currentPrice, (e.baselinePnlPct ?: e.pnlPct)?.toDoubleOrNull())
        } else {
            val mitBasis = z.filter { it.baselinePrice != null }
            val menge = mitBasis.sumOf { it.quantity.coerceAtLeast(1) }
            val basis = if (menge > 0) mitBasis.sumOf { (it.baselinePrice ?: 0.0) * it.quantity.coerceAtLeast(1) } / menge else null
            val markt = z[0].currentPrice ?: 0.0
            // 0.01 wie PNL_EPS auf dem Server: Ein Kaufpreis von 0 teilt sonst durch null.
            val pct = if (basis != null && markt > 0) (markt - basis) / maxOf(basis, 0.01) * 100 else null
            KachelPreis(z[0].currentPrice, pct?.let { Math.round(it * 10) / 10.0 })
        }
    }

/** Der Betrag auf der Kachel: Marktpreis, sonst der mengengewichtete Kaufpreis — wie im Web. */
fun kachelBetrag(set: SetItem, preis: KachelPreis?): Double? =
    preis?.marktpreis?.takeIf { it > 0 } ?: set.avgPurchasePrice ?: set.maxPurchasePrice
