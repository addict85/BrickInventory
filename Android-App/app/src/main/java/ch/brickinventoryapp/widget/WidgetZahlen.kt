package ch.brickinventoryapp.widget

import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.PortfolioHistoryResponse
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.fmtProzent
import kotlinx.serialization.Serializable

/**
 * Was das Startbildschirm-Widget zeigt: Sammlungswert, G&V heute und gesamt.
 * Als eigenes Modell, damit das Widget die Zahlen auch ohne Netz aus der Ablage
 * zeigen kann und die Rechnung ohne Android prüfbar bleibt.
 */
@Serializable
data class WidgetZahlen(
    val waehrung: String,
    val wert: Double? = null,
    val gesamt: Double? = null,
    val gesamtProzent: Double? = null,
    val heute: Double? = null,
    val heuteProzent: Double? = null,
    /** Wann die Zahlen geholt wurden, Millisekunden seit 1970. */
    val stand: Long = 0,
)

/**
 * Gesamt-G&V aus der G&V-Übersicht des Servers (aktueller Wert minus Kaufpreis,
 * über Sets, Teile und Figuren). Für „heute“ gibt es keinen eigenen Abruf: Der
 * Wochenverlauf hat einen Punkt je Tag, heute ist die Differenz der letzten zwei.
 */
fun widgetZahlen(pnl: PnlResponse?, verlauf: PortfolioHistoryResponse?, jetzt: Long): WidgetZahlen? {
    if (pnl == null && verlauf == null) return null
    val waehrung = pnl?.currency ?: verlauf?.currency ?: "EUR"
    val wert = pnl?.totals?.current?.toDoubleOrNull() ?: verlauf?.points?.lastOrNull()?.value
    val kauf = pnl?.totals?.purchase?.toDoubleOrNull()
    val gesamt = if (wert != null && kauf != null) wert - kauf else null
    val punkte = verlauf?.points.orEmpty()
    val (heute, heuteProzent) = if (punkte.size >= 2) {
        val vorher = punkte[punkte.size - 2].value
        val diff = punkte.last().value - vorher
        diff to (if (vorher != 0.0) diff / vorher * 100 else null)
    } else null to null
    return WidgetZahlen(waehrung, wert, gesamt, pnl?.totals?.pnlProzent, heute, heuteProzent, jetzt)
}

/** Ein Betrag mit Vorzeichen und, wenn bekannt, der Prozentzahl daneben. */
fun gvText(betrag: Double?, prozent: Double?, waehrung: String): String {
    if (betrag == null) return "—"
    val vorzeichen = if (betrag > 0.005) "+" else ""
    val geld = vorzeichen + fmtMoney(betrag, waehrung)
    return if (prozent != null) "$geld (${fmtProzent(prozent)})" else geld
}
