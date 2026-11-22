package ch.brickinventoryapp.app.widget

import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ProfitView
import ch.brickinventoryapp.model.domain.ValueHistoryView
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtPercent
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * What the home screen widget shows: collection value, P&L today and in total.
 * As its own model so that the widget can show the numbers from the store even without network
 * and the calculation stays checkable without Android.
 */
@Serializable
data class WidgetNumbers(
    @SerialName("waehrung") val currency: CurrencyCode,
    @SerialName("wert") val value: Double? = null,
    @SerialName("gesamt") val total: Double? = null,
    @SerialName("gesamtProzent") val totalPercent: Double? = null,
    @SerialName("heute") val today: Double? = null,
    @SerialName("heuteProzent") val todayPercent: Double? = null,
    /** When the numbers were fetched, milliseconds since 1970. */
    @SerialName("stand") val state: Long = 0,
)

/**
 * Total P&L from the server's P&L overview. If it supplies the basis (only positions
 * with purchase and market price), value and P&L stand on it as in the finance card, because
 * pnl_prozent computes there; older servers: current value minus purchase price. For “today”
 * there is no separate fetch: the weekly history has one point per day.
 */
fun widgetNumbers(pnl: ProfitView?, history: ValueHistoryView?, now: Long): WidgetNumbers? {
    if (pnl == null && history == null) return null
    val currency = pnl?.currency ?: history?.currency ?: CurrencyCode.EUR
    val t = pnl?.totals
    val withBase = t?.basisCostBasis != null && (t.positionsValued ?: 0) > 0
    val value = (if (withBase) t.basisMarketValue else t?.current)?.toDoubleOrNull()
        ?: history?.points?.lastOrNull()?.value?.asDouble()
    val purchase = t?.purchase?.toDoubleOrNull()
    val total = when {
        withBase -> t.basisPnlAmount?.toDoubleOrNull()
        t?.basisCostBasis != null -> null
        value != null && purchase != null -> value - purchase
        else -> null
    }
    val points = history?.points.orEmpty()
    val (today, todayPercent) = if (points.size >= 2) {
        val before = points[points.size - 2].value.asDouble()
        val diff = points.last().value.asDouble() - before
        diff to (if (before != 0.0) diff / before * 100 else null)
    } else null to null
    return WidgetNumbers(currency, value, total, pnl?.totals?.pnlPercent, today, todayPercent, now)
}

/**
 * What the widget may show: signed out nothing, even if the store still holds
 * numbers. Emptying on sign-out can fail to happen (process ended, error in the
 * hook); the home screen should then not show numbers of a foreign account.
 */
fun widgetDisplay(stored: WidgetNumbers?, loggedIn: Boolean): WidgetNumbers? =
    if (loggedIn) stored else null

/** What the worker does without a token. */
enum class WithoutToken { CLEAR, LATER }

/**
 * Signed out, the store is emptied. With a locked device the token has merely not been
 * read yet (its key only works unlocked); emptied, an empty widget would stand there
 * after unlocking until the next run.
 */
fun withoutToken(deviceLocked: Boolean): WithoutToken = if (deviceLocked) WithoutToken.LATER else WithoutToken.CLEAR

/** Instead of an amount, as long as the user has not allowed money values in the widget. */
const val WIDGET_HIDDEN = "••••"

/**
 * Value, P&L today and in total as text. Without permission ([show]) hidden: the widget
 * lies on the home screen, readable for anyone who sees the phone.
 */
fun widgetValues(z: WidgetNumbers, show: Boolean): Triple<String, String, String> =
    if (!show) Triple(WIDGET_HIDDEN, WIDGET_HIDDEN, WIDGET_HIDDEN)
    else Triple(
        z.value?.let { fmtMoney(it, z.currency) } ?: "—",
        gvText(z.today, z.todayPercent, z.currency),
        gvText(z.total, z.totalPercent, z.currency),
    )

/** An amount with sign and, if known, the percentage next to it. */
fun gvText(amount: Double?, percent: Double?, currency: CurrencyCode): String {
    if (amount == null) return "—"
    val sign = if (amount > 0.005) "+" else ""
    val money = sign + fmtMoney(amount, currency)
    return if (percent != null) "$money (${fmtPercent(percent)})" else money
}
