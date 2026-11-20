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
 * Was eine Karte der Finanzliste zeigt. Die Zahlen kommen fertig gerundet vom
 * Server (wert_gesamt, pnl_prozent); gerechnet wird nur Kauf mal Menge, in Geld.
 */
data class FinanceRow(
    val schluessel: String,
    val menge: Int,
    /** Marktwert der Zeile; null = kein Marktpreis. */
    val wert: Geld?,
    val kaufpreis: Geld?,
    /** Zustand der Erfassung; null bei einem Eintrag ohne Erfassungen. */
    val zustand: Zustand?,
    val pnlProzent: Double?,
) {
    /**
     * Der Kauf aller Stück der Zeile. Der Server liefert den Kaufpreis je Stück, den
     * Marktwert aber für die ganze Zeile (wert_gesamt); nebeneinander gestellt las sich
     * „Kauf: 400“ neben „899.90“ bei zwei Stück wie ein Gewinn von 125 %.
     */
    val kaufGesamt: Geld?
        get() = kaufpreis?.let { it * menge.coerceAtLeast(1) }

    /** Gewinn oder Verlust in Geld, auf derselben Grundlage wie [pnlProzent]. */
    val gewinn: Geld?
        get() {
            val w = wert ?: return null
            val k = kaufGesamt ?: return null
            return w - k
        }
}

/**
 * Eine Karte je Kaufpreis, sobald es mehrere gibt — jede mit dem Marktpreis
 * ihres Zustands. Sonst eine Karte für den Eintrag (die einzige Erfassung oder
 * keine).
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
            // Mit Erfassung gilt nur deren G&V: Fehlt ihr Kaufpreis, gibt es keine.
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

/** Die drei Teilsummen und der Gesamtwert der Finanzseite. */
data class FinanceSums(val sets: BigDecimal, val teile: BigDecimal, val figuren: BigDecimal, val gesamt: BigDecimal) {
    val partsAndMinifigs: BigDecimal get() = teile + figuren
}

private fun betrag(text: String?): BigDecimal = text?.trim()?.toBigDecimalOrNull() ?: BigDecimal.ZERO

/**
 * Der Gesamtwert kommt vom Server (grand_total). Fehlt er (älterer Server),
 * addiert die App die drei Serversummen — in BigDecimal, weil 0.1 + 0.2 als
 * Double nicht 0.3 ist und die Summe sonst neben der Kopfkachel abwiche.
 */
fun finanzSummen(valuation: BewertungAnsicht, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): FinanceSums {
    val sets = betrag(valuation.totals.avg)
    val teile = betrag(parts?.totalValue)
    val figuren = betrag(figs?.totalValue)
    val gesamt = pnl?.totals?.grandTotal?.trim()?.toBigDecimalOrNull() ?: (sets + teile + figuren)
    return FinanceSums(sets, teile, figuren, gesamt)
}

/**
 * Wie viele Kaufpreise in einer anderen Währung fehlen. /finance/pnl zählt über
 * alle drei Arten; ohne diese Antwort die Zahlen der drei Bewertungen.
 */
internal fun foreignPurchasePrices(valuation: BewertungAnsicht?, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): Int =
    pnl?.totals?.kaufpreiseFremdeWaehrung
        ?: ((valuation?.kaufpreiseFremdeWaehrung ?: 0) + (parts?.kaufpreiseFremdeWaehrung ?: 0) +
            (figs?.kaufpreiseFremdeWaehrung ?: 0))

/**
 * Was die Kopfkarte zeigt. [withBase]: Der Server hat Positionen mit Kauf- UND
 * Marktpreis gerechnet; dann stammen Einstand, Marktwert und G/V aus dieser einen
 * Basis, damit Einstand + G/V = Marktwert gilt (wie im Web, basisAus).
 * [baseKnown] ist false bei älteren Servern ohne diese Felder.
 */
internal data class FinanceHeader(
    val baseKnown: Boolean,
    val withBase: Boolean,
    /** null = nicht bekannt (älterer Server). */
    val cost: BigDecimal?,
    val wert: BigDecimal,
    /** null = keine G/V (ohne Basis). */
    val guvAmount: BigDecimal?,
    val guvPercent: Double?,
    val gesamt: Int = 0,
    val valued: Int = 0,
    val withoutMarket: Int = 0,
    val withoutMarketCost: BigDecimal = BigDecimal.ZERO,
    val withoutPurchase: Int = 0,
    val withoutPurchaseValue: BigDecimal = BigDecimal.ZERO,
) {
    /** Die Basiszeile steht nur, wenn gerechnet wurde und etwas fehlt — sonst sagt sie nichts. */
    val baseRowVisible: Boolean get() = withBase && (withoutMarket > 0 || withoutPurchase > 0)
}

/**
 * Ohne Basisfelder (älterer Server) bleibt die Karte, wie sie war: Gesamtwert und
 * pnl_prozent. Mit Basis, aber ohne eine bewertete Position, stehen die Summen aller
 * Positionen da und keine G/V — eine Prozentzahl gegen nichts wäre erfunden.
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
