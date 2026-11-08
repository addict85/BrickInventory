package ch.brickinventoryapp.app.widget

import ch.brickinventoryapp.model.data.model.PnlResponse
import ch.brickinventoryapp.model.data.model.PortfolioHistoryResponse
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
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
 * Gesamt-G&V aus der G&V-Übersicht des Servers. Liefert er die Basis (nur Positionen
 * mit Kauf- und Marktpreis), stehen Wert und G&V wie in der Finanzkarte auf ihr, denn
 * pnl_prozent rechnet dort; ältere Server: aktueller Wert minus Kaufpreis. Für „heute“
 * gibt es keinen eigenen Abruf: Der Wochenverlauf hat einen Punkt je Tag.
 */
fun widgetZahlen(pnl: PnlResponse?, verlauf: PortfolioHistoryResponse?, jetzt: Long): WidgetZahlen? {
    if (pnl == null && verlauf == null) return null
    val waehrung = pnl?.currency ?: verlauf?.currency ?: "EUR"
    val t = pnl?.totals
    val mitBasis = t?.basisEinstand != null && (t.positionenBewertet ?: 0) > 0
    val wert = (if (mitBasis) t.basisMarktwert else t?.current)?.toDoubleOrNull()
        ?: verlauf?.points?.lastOrNull()?.value
    val kauf = t?.purchase?.toDoubleOrNull()
    val gesamt = when {
        mitBasis -> t.basisGuvBetrag?.toDoubleOrNull()
        t?.basisEinstand != null -> null
        wert != null && kauf != null -> wert - kauf
        else -> null
    }
    val punkte = verlauf?.points.orEmpty()
    val (heute, heuteProzent) = if (punkte.size >= 2) {
        val vorher = punkte[punkte.size - 2].value
        val diff = punkte.last().value - vorher
        diff to (if (vorher != 0.0) diff / vorher * 100 else null)
    } else null to null
    return WidgetZahlen(waehrung, wert, gesamt, pnl?.totals?.pnlProzent, heute, heuteProzent, jetzt)
}

/**
 * Was das Widget zeigen darf: abgemeldet nichts, auch wenn die Ablage noch Zahlen
 * hält. Das Leeren beim Abmelden kann ausbleiben (Prozess beendet, Fehler im
 * Haken); der Startbildschirm soll dann keine Zahlen eines fremden Kontos zeigen.
 */
fun widgetAnzeige(abgelegt: WidgetZahlen?, angemeldet: Boolean): WidgetZahlen? =
    if (angemeldet) abgelegt else null

/** Statt eines Betrags, solange der Nutzer Geldwerte im Widget nicht erlaubt hat. */
const val WIDGET_VERDECKT = "••••"

/**
 * Wert, G&V heute und gesamt als Text. Ohne Erlaubnis ([zeigen]) verdeckt: Das Widget
 * liegt auf dem Startbildschirm, lesbar für jeden, der das Telefon sieht.
 */
fun widgetWerte(z: WidgetZahlen, zeigen: Boolean): Triple<String, String, String> =
    if (!zeigen) Triple(WIDGET_VERDECKT, WIDGET_VERDECKT, WIDGET_VERDECKT)
    else Triple(
        z.wert?.let { fmtMoney(it, z.waehrung) } ?: "—",
        gvText(z.heute, z.heuteProzent, z.waehrung),
        gvText(z.gesamt, z.gesamtProzent, z.waehrung),
    )

/** Ein Betrag mit Vorzeichen und, wenn bekannt, der Prozentzahl daneben. */
fun gvText(betrag: Double?, prozent: Double?, waehrung: String): String {
    if (betrag == null) return "—"
    val vorzeichen = if (betrag > 0.005) "+" else ""
    val geld = vorzeichen + fmtMoney(betrag, waehrung)
    return if (prozent != null) "$geld (${fmtProzent(prozent)})" else geld
}
