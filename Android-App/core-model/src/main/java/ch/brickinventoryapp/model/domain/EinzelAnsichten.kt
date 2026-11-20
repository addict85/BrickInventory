package ch.brickinventoryapp.model.domain

import java.time.Instant

/** „Keine Farbe“ für die Oberfläche — derselbe Wert wie im Server-Modell, ein Name. */
const val OHNE_FARBE: Int = KEINE_FARBE

/**
 * Was der CSV-Import anbietet. Eine eigene Aufzählung, damit die Auswahl in der
 * Oberfläche nicht am Server-Modell hängt; [asData] übersetzt beim Hochladen.
 */
enum class CsvImportKind { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }

/** Startzustand des Servers; [share] ist schon gerechnet (0..1), null ohne Gesamtzahl. */
data class StartStateView(
    val bereit: Boolean,
    val schritt: String?,
    val undercut: String?,
    val fortschritt: Double,
    val gesamt: Int,
) {
    val share: Float? get() = if (gesamt > 0) (fortschritt / gesamt).toFloat().coerceIn(0f, 1f) else null
}

/** Ein Punkt der Wertentwicklung; [yFrac] ist die Höhe 0..1, wie sie der Server schon gerechnet hat. */
data class DiagrammPunkt(val xLabel: String, val wert: Geld, val yFrac: Double)

data class ChartAxis(val label: String, val wert: Geld, val frac: Double)

/** Der Verlauf des Sammlungswerts: je Tag ein Punkt, die Achse und die Veränderung im Zeitraum. */
data class ValueHistoryView(
    val waehrung: Waehrung,
    val changePercent: Double?,
    val punkte: List<DiagrammPunkt>,
    val yAchse: List<ChartAxis>,
    val days: List<String>,
)

data class ColorView(val id: Int, val name: String, val hex: String?)

/** Ein Gutschein; [pin] null heisst „keine“ oder „offline nicht abgelegt“. */
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

/** Ein Preisalarm; [unter] ist die Richtung als Wahrheitswert statt als Wort. */
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

/** Was seit der letzten Marke ausgelöst hat; [marke] ist die Zeit des Servers für die nächste Frage. */
data class AlarmabrufView(val alerts: List<PriceAlertView>, val marke: String?)
