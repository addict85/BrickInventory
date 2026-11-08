package ch.brickinventoryapp.finanzen.ui

import ch.brickinventoryapp.model.ui.model.BewertungAnsicht
import ch.brickinventoryapp.model.ui.model.BewertungSetAnsicht
import ch.brickinventoryapp.model.ui.model.BewertungsKaufAnsicht
import ch.brickinventoryapp.model.ui.model.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.ui.model.GewinnAnsicht
import ch.brickinventoryapp.model.ui.model.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.ui.model.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.ui.model.TeileBewertungAnsicht
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
) {
    /**
     * Der Kauf aller Stück der Zeile. Der Server liefert den Kaufpreis je Stück, den
     * Marktwert aber für die ganze Zeile (wert_gesamt); nebeneinander gestellt las sich
     * „Kauf: 400“ neben „899.90“ bei zwei Stück wie ein Gewinn von 125 %.
     */
    val kaufGesamt: Double?
        get() = kaufpreis?.let { BigDecimal.valueOf(it).multiply(BigDecimal(menge.coerceAtLeast(1))).toDouble() }

    /** Gewinn oder Verlust in Geld, auf derselben Grundlage wie [pnlProzent]. */
    val gewinn: Double?
        get() {
            val w = wert ?: return null
            val k = kaufGesamt ?: return null
            return BigDecimal.valueOf(w).subtract(BigDecimal.valueOf(k)).toDouble()
        }
}

/**
 * Eine Karte je Kaufpreis, sobald es mehrere gibt — jede mit dem Marktpreis
 * ihres Zustands. Sonst eine Karte für den Eintrag (die einzige Erfassung oder
 * keine).
 */
private fun <T> jeKaufpreis(eintraege: List<T>, erfassungen: (T) -> List<BewertungsKaufAnsicht>) =
    eintraege.flatMap { e ->
        val a = erfassungen(e)
        if (a.size > 1) a.map { e to it } else listOf(e to a.firstOrNull())
    }

fun setZeilen(sets: List<BewertungSetAnsicht>): List<Pair<BewertungSetAnsicht, FinanzZeile>> =
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

fun teilZeilen(parts: List<ManuellesTeilAnsicht>): List<Pair<ManuellesTeilAnsicht, FinanzZeile>> =
    jeKaufpreis(parts) { it.acquisitions }.map { (p, acq) ->
        p to FinanzZeile("part_${p.id}#${acq?.id ?: 0}", acq?.quantity ?: p.quantity,
            acq?.wertGesamt ?: p.wertGesamt, acq?.purchasePrice ?: p.purchasePrice,
            acq?.condition, acq?.pnlProzent ?: p.pnlProzent)
    }

fun figurZeilen(figs: List<ManuelleFigurAnsicht>): List<Pair<ManuelleFigurAnsicht, FinanzZeile>> =
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
fun finanzSummen(valuation: BewertungAnsicht, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): FinanzSummen {
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
fun fremdeKaufpreise(valuation: BewertungAnsicht?, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): Int =
    pnl?.totals?.kaufpreiseFremdeWaehrung
        ?: ((valuation?.kaufpreiseFremdeWaehrung ?: 0) + (parts?.kaufpreiseFremdeWaehrung ?: 0) +
            (figs?.kaufpreiseFremdeWaehrung ?: 0))

/**
 * Was die Kopfkarte zeigt. [mitBasis]: Der Server hat Positionen mit Kauf- UND
 * Marktpreis gerechnet; dann stammen Einstand, Marktwert und G/V aus dieser einen
 * Basis, damit Einstand + G/V = Marktwert gilt (wie im Web, basisAus).
 * [basisBekannt] ist false bei älteren Servern ohne diese Felder.
 */
data class FinanzKopf(
    val basisBekannt: Boolean,
    val mitBasis: Boolean,
    /** null = nicht bekannt (älterer Server). */
    val einstand: BigDecimal?,
    val wert: BigDecimal,
    /** null = keine G/V (ohne Basis). */
    val guvBetrag: BigDecimal?,
    val guvProzent: Double?,
    val gesamt: Int = 0,
    val bewertet: Int = 0,
    val ohneMarkt: Int = 0,
    val ohneMarktEinstand: BigDecimal = BigDecimal.ZERO,
    val ohneKauf: Int = 0,
    val ohneKaufWert: BigDecimal = BigDecimal.ZERO,
) {
    /** Die Basiszeile steht nur, wenn gerechnet wurde und etwas fehlt — sonst sagt sie nichts. */
    val basisZeileSichtbar: Boolean get() = mitBasis && (ohneMarkt > 0 || ohneKauf > 0)
}

/**
 * Ohne Basisfelder (älterer Server) bleibt die Karte, wie sie war: Gesamtwert und
 * pnl_prozent. Mit Basis, aber ohne eine bewertete Position, stehen die Summen aller
 * Positionen da und keine G/V — eine Prozentzahl gegen nichts wäre erfunden.
 */
fun finanzKopf(valuation: BewertungAnsicht, parts: TeileBewertungAnsicht?, figs: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?): FinanzKopf {
    val alle = finanzSummen(valuation, parts, figs, pnl).gesamt
    val t = pnl?.totals
    if (t?.basisEinstand == null)
        return FinanzKopf(basisBekannt = false, mitBasis = false, einstand = null, wert = alle,
            guvBetrag = null, guvProzent = t?.pnlProzent)
    val bewertet = t.positionenBewertet ?: 0
    val mitBasis = bewertet > 0
    return FinanzKopf(
        basisBekannt = true,
        mitBasis = mitBasis,
        einstand = if (mitBasis) betrag(t.basisEinstand) else t.purchase.trim().toBigDecimalOrNull(),
        wert = if (mitBasis) betrag(t.basisMarktwert) else alle,
        guvBetrag = if (mitBasis) betrag(t.basisGuvBetrag) else null,
        guvProzent = if (mitBasis) t.pnlProzent else null,
        gesamt = t.positionen ?: 0,
        bewertet = bewertet,
        ohneMarkt = t.positionenOhneMarktpreis ?: 0,
        ohneMarktEinstand = betrag(t.ohneMarktpreisEinstand),
        ohneKauf = t.positionenOhneKaufpreis ?: 0,
        ohneKaufWert = betrag(t.ohneKaufpreisMarktwert),
    )
}
