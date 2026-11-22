package ch.brickinventoryapp.app.widget

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.GewinnAnsicht
import ch.brickinventoryapp.model.domain.ValueHistoryView
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
import kotlinx.serialization.Serializable

/**
 * What the home screen widget shows: collection value, P&L today and in total.
 * As its own model so that the widget can show the numbers from the store even without network
 * and the calculation stays checkable without Android.
 */
@Serializable
data class WidgetZahlen(
    val waehrung: Waehrung,
    val wert: Double? = null,
    val gesamt: Double? = null,
    val gesamtProzent: Double? = null,
    val heute: Double? = null,
    val heuteProzent: Double? = null,
    /** When the numbers were fetched, milliseconds since 1970. */
    val stand: Long = 0,
)

/**
 * Total P&L from the server's P&L overview. If it supplies the basis (only positions
 * with purchase and market price), value and P&L stand on it as in the finance card, because
 * pnl_prozent computes there; older servers: current value minus purchase price. For “today”
 * there is no separate fetch: the weekly history has one point per day.
 */
fun widgetNumbers(pnl: GewinnAnsicht?, verlauf: ValueHistoryView?, jetzt: Long): WidgetZahlen? {
    if (pnl == null && verlauf == null) return null
    val waehrung = pnl?.currency ?: verlauf?.waehrung ?: Waehrung.EUR
    val t = pnl?.totals
    val withBase = t?.basisEinstand != null && (t.positionenBewertet ?: 0) > 0
    val wert = (if (withBase) t.basisMarktwert else t?.current)?.toDoubleOrNull()
        ?: verlauf?.punkte?.lastOrNull()?.wert?.asDouble()
    val kauf = t?.purchase?.toDoubleOrNull()
    val gesamt = when {
        withBase -> t.basisGuvBetrag?.toDoubleOrNull()
        t?.basisEinstand != null -> null
        wert != null && kauf != null -> wert - kauf
        else -> null
    }
    val punkte = verlauf?.punkte.orEmpty()
    val (heute, heuteProzent) = if (punkte.size >= 2) {
        val vorher = punkte[punkte.size - 2].wert.asDouble()
        val diff = punkte.last().wert.asDouble() - vorher
        diff to (if (vorher != 0.0) diff / vorher * 100 else null)
    } else null to null
    return WidgetZahlen(waehrung, wert, gesamt, pnl?.totals?.pnlProzent, heute, heuteProzent, jetzt)
}

/**
 * What the widget may show: signed out nothing, even if the store still holds
 * numbers. Emptying on sign-out can fail to happen (process ended, error in the
 * hook); the home screen should then not show numbers of a foreign account.
 */
fun widgetDisplay(abgelegt: WidgetZahlen?, angemeldet: Boolean): WidgetZahlen? =
    if (angemeldet) abgelegt else null

/** What the worker does without a token. */
enum class WithoutToken { LEEREN, LATER }

/**
 * Signed out, the store is emptied. With a locked device the token has merely not been
 * read yet (its key only works unlocked); emptied, an empty widget would stand there
 * after unlocking until the next run.
 */
fun ohneToken(deviceLocked: Boolean): WithoutToken = if (deviceLocked) WithoutToken.LATER else WithoutToken.LEEREN

/** Instead of an amount, as long as the user has not allowed money values in the widget. */
const val WIDGET_HIDDEN = "••••"

/**
 * Value, P&L today and in total as text. Without permission ([zeigen]) hidden: the widget
 * lies on the home screen, readable for anyone who sees the phone.
 */
fun widgetValues(z: WidgetZahlen, zeigen: Boolean): Triple<String, String, String> =
    if (!zeigen) Triple(WIDGET_HIDDEN, WIDGET_HIDDEN, WIDGET_HIDDEN)
    else Triple(
        z.wert?.let { fmtMoney(it, z.waehrung) } ?: "—",
        gvText(z.heute, z.heuteProzent, z.waehrung),
        gvText(z.gesamt, z.gesamtProzent, z.waehrung),
    )

/** An amount with sign and, if known, the percentage next to it. */
fun gvText(betrag: Double?, prozent: Double?, waehrung: Waehrung): String {
    if (betrag == null) return "—"
    val sign = if (betrag > 0.005) "+" else ""
    val money = sign + fmtMoney(betrag, waehrung)
    return if (prozent != null) "$money (${fmtProzent(prozent)})" else money
}
