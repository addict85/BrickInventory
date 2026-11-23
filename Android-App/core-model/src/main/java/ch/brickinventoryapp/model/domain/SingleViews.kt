package ch.brickinventoryapp.model.domain

import java.time.Instant

/** „No color“ for the UI — the same value as in the server model, one name. */
const val WITHOUT_COLOR: Int = NO_COLOR

/**
 * What the CSV import offers. An own enumeration, so that the choice in the
 * UI does not hang on the server model; [asData] translates when uploading.
 */
enum class CsvImportKind { SETS, PARTS, MINIFIGS, WANTED_LIST, PRICE_ALARMS }

/** Startup state of the server; [share] is already calculated (0..1), null without a total. */
data class StartStateView(
    val ready: Boolean,
    val step: String?,
    val undercut: String?,
    val progress: Double,
    val total: Int,
) {
    val share: Float? get() = if (total > 0) (progress / total).toFloat().coerceIn(0f, 1f) else null
}

/** A point of the value development; [yFrac] is the height 0..1 as the server already calculated it. */
data class PricePoint(val xLabel: String, val value: Money, val yFrac: Double)

data class ChartAxis(val label: String, val value: Money, val frac: Double)

/** The history of the collection value: one point per day, the axis and the change in the period. */
data class ValueHistoryView(
    val currency: CurrencyCode,
    val changePercent: Double?,
    val points: List<PricePoint>,
    val yAxis: List<ChartAxis>,
    val days: List<String>,
)

data class ColorView(val id: Int, val name: String, val hex: String?)

/** A voucher; [pin] null means „none“ or „not stored offline“. */
data class VoucherView(
    val id: Int,
    val number: String,
    val pin: String?,
    val amount: Money,
    val currency: CurrencyCode,
    val hasPdf: Boolean,
    val createdAt: Instant?,
    val balanceCheckedAt: Instant?,
)

/** A price alert; [below] is the direction as a boolean instead of a word. */
data class PriceAlertView(
    val setNumber: String,
    val condition: Condition,
    val direction: AlarmDirection,
    val threshold: Money,
    val currencyCode: CurrencyCode,
    val triggered: Boolean,
    val lastlyAt: Instant?,
    val lastlyPrice: Money?,
    val name: String?,
    val imageLocal: String?,
    val imageUrl: String?,
    val setImgUrl: String?,
    val owns: Boolean,
) {
    val below: Boolean get() = direction == AlarmDirection.BELOW
}

/** What has triggered since the last mark; [brand] is the server's time for the next question. */
data class AlarmFetchView(val alerts: List<PriceAlertView>, val brand: String?)
