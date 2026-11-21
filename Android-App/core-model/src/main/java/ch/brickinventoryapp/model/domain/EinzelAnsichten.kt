package ch.brickinventoryapp.model.domain

import java.time.Instant

/** „No color“ for the UI — the same value as in the server model, one name. */
const val OHNE_FARBE: Int = KEINE_FARBE

/**
 * What the CSV import offers. An own enumeration, so that the choice in the
 * UI does not hang on the server model; [asData] translates when uploading.
 */
enum class CsvImportKind { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }

/** Startup state of the server; [share] is already calculated (0..1), null without a total. */
data class StartStateView(
    val bereit: Boolean,
    val schritt: String?,
    val undercut: String?,
    val fortschritt: Double,
    val gesamt: Int,
) {
    val share: Float? get() = if (gesamt > 0) (fortschritt / gesamt).toFloat().coerceIn(0f, 1f) else null
}

/** A point of the value development; [yFrac] is the height 0..1 as the server already calculated it. */
data class DiagrammPunkt(val xLabel: String, val wert: Geld, val yFrac: Double)

data class ChartAxis(val label: String, val wert: Geld, val frac: Double)

/** The history of the collection value: one point per day, the axis and the change in the period. */
data class ValueHistoryView(
    val waehrung: Waehrung,
    val changePercent: Double?,
    val punkte: List<DiagrammPunkt>,
    val yAchse: List<ChartAxis>,
    val days: List<String>,
)

data class ColorView(val id: Int, val name: String, val hex: String?)

/** A voucher; [pin] null means „none“ or „not stored offline“. */
data class VoucherView(
    val id: Int,
    val number: String,
    val pin: String?,
    val amount: Geld,
    val currency: Waehrung,
    val hatPdf: Boolean,
    val createdAt: Instant?,
    val guthabenGeprueftAm: Instant?,
)

/** A price alert; [unter] is the direction as a boolean instead of a word. */
data class PriceAlertView(
    val setNumber: String,
    val condition: Zustand,
    val richtung: Alarmrichtung,
    val schwelle: Geld,
    val currencyCode: Waehrung,
    val ausgeloest: Boolean,
    val lastlyAt: Instant?,
    val lastlyPrice: Geld?,
    val name: String?,
    val imageLocal: String?,
    val imageUrl: String?,
    val setImgUrl: String?,
    val besitzt: Boolean,
) {
    val unter: Boolean get() = richtung == Alarmrichtung.UNTER
}

/** What has triggered since the last mark; [marke] is the server's time for the next question. */
data class AlarmabrufView(val alerts: List<PriceAlertView>, val marke: String?)
