package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.FigsValuationResponse
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.PartsValuationResponse
import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.ValuationAcquisition
import ch.brickinventoryapp.data.model.ValuationResponse
import ch.brickinventoryapp.data.model.ValuationSet
import java.math.BigDecimal

/**
 * Was eine Karte der Finanzliste zeigt. Die Zahlen kommen fertig gerundet vom
 * Server (wert_gesamt, pnl_prozent); hier wird nur gewählt, nicht gerechnet,
 * deshalb genügt Double für die Anzeige.
 */
data class FinanzZeile(
    val schluessel: String,
    val menge: Int,
    /** Marktwert der Zeile; null = kein Marktpreis. */
    val wert: Double?,
    val kaufpreis: Double?,
    /** Zustand der Erfassung; null bei einem Eintrag ohne Erfassungen. */
    val zustand: String?,
    val pnlProzent: Double?,
)

/**
 * Eine Karte je Kaufpreis, sobald es mehrere gibt — jede mit dem Marktpreis
 * ihres Zustands. Sonst eine Karte für den Eintrag (die einzige Erfassung oder
 * keine).
 */
private fun <T> jeKaufpreis(eintraege: List<T>, erfassungen: (T) -> List<ValuationAcquisition>) =
    eintraege.flatMap { e ->
        val a = erfassungen(e)
        if (a.size > 1) a.map { e to it } else listOf(e to a.firstOrNull())
    }

fun setZeilen(sets: List<ValuationSet>): List<Pair<ValuationSet, FinanzZeile>> =
    jeKaufpreis(sets) { it.acquisitions }.map { (s, acq) ->
        s to FinanzZeile(
            schluessel = "${s.setNumber}#${acq?.id ?: 0}",
            menge = acq?.quantity ?: s.quantity,
            wert = acq?.wertGesamt ?: s.wertGesamt,
            kaufpreis = acq?.purchasePrice ?: s.purchasePrice,
            zustand = acq?.condition,
            // Mit Erfassung gilt nur deren G&V: Fehlt ihr Kaufpreis, gibt es keine.
            pnlProzent = if (acq != null) acq.pnlProzent else s.pnlProzent,
        )
    }

fun teilZeilen(parts: List<PartValuationItem>): List<Pair<PartValuationItem, FinanzZeile>> =
    jeKaufpreis(parts) { it.acquisitions }.map { (p, acq) ->
        p to FinanzZeile("part_${p.id}#${acq?.id ?: 0}", acq?.quantity ?: p.quantity,
            acq?.wertGesamt ?: p.wertGesamt, acq?.purchasePrice ?: p.purchasePrice,
            acq?.condition, acq?.pnlProzent ?: p.pnlProzent)
    }

fun figurZeilen(figs: List<FigValuationItem>): List<Pair<FigValuationItem, FinanzZeile>> =
    jeKaufpreis(figs) { it.acquisitions }.map { (f, acq) ->
        f to FinanzZeile("fig_${f.id}#${acq?.id ?: 0}", acq?.quantity ?: f.quantity,
            acq?.wertGesamt ?: f.wertGesamt, acq?.purchasePrice ?: f.purchasePrice,
            acq?.condition, acq?.pnlProzent ?: f.pnlProzent)
    }

/** Die drei Teilsummen und der Gesamtwert der Finanzseite. */
data class FinanzSummen(val sets: BigDecimal, val teile: BigDecimal, val figuren: BigDecimal, val gesamt: BigDecimal) {
    val teileUndFiguren: BigDecimal get() = teile + figuren
}

private fun betrag(text: String?): BigDecimal = text?.trim()?.toBigDecimalOrNull() ?: BigDecimal.ZERO

/**
 * Der Gesamtwert kommt vom Server (grand_total). Fehlt er (älterer Server),
 * addiert die App die drei Serversummen — in BigDecimal, weil 0.1 + 0.2 als
 * Double nicht 0.3 ist und die Summe sonst neben der Kopfkachel abwiche.
 */
fun finanzSummen(valuation: ValuationResponse, parts: PartsValuationResponse?, figs: FigsValuationResponse?, pnl: PnlResponse?): FinanzSummen {
    val sets = betrag(valuation.totals.avg)
    val teile = betrag(parts?.totalValue)
    val figuren = betrag(figs?.totalValue)
    val gesamt = pnl?.totals?.grandTotal?.trim()?.toBigDecimalOrNull() ?: (sets + teile + figuren)
    return FinanzSummen(sets, teile, figuren, gesamt)
}

/**
 * Wie viele Kaufpreise in einer anderen Währung fehlen. /finance/pnl zählt über
 * alle drei Arten; ohne diese Antwort die Zahlen der drei Bewertungen.
 */
fun fremdeKaufpreise(valuation: ValuationResponse?, parts: PartsValuationResponse?, figs: FigsValuationResponse?, pnl: PnlResponse?): Int =
    pnl?.totals?.kaufpreiseFremdeWaehrung
        ?: ((valuation?.kaufpreiseFremdeWaehrung ?: 0) + (parts?.kaufpreiseFremdeWaehrung ?: 0) +
            (figs?.kaufpreiseFremdeWaehrung ?: 0))
