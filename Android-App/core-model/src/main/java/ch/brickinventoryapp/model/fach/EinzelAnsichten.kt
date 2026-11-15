package ch.brickinventoryapp.model.fach

import java.time.Instant

/** „Keine Farbe“ für die Oberfläche — derselbe Wert wie im Server-Modell, ein Name. */
const val OHNE_FARBE: Int = KEINE_FARBE

/**
 * Was der CSV-Import anbietet. Eine eigene Aufzählung, damit die Auswahl in der
 * Oberfläche nicht am Server-Modell hängt; [alsDaten] übersetzt beim Hochladen.
 */
enum class CsvImportArt { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }

/** Startzustand des Servers; [anteil] ist schon gerechnet (0..1), null ohne Gesamtzahl. */
data class StartzustandAnsicht(
    val bereit: Boolean,
    val schritt: String?,
    val unterschritt: String?,
    val fortschritt: Double,
    val gesamt: Int,
) {
    val anteil: Float? get() = if (gesamt > 0) (fortschritt / gesamt).toFloat().coerceIn(0f, 1f) else null
}

/** Ein Punkt der Wertentwicklung; [yFrac] ist die Höhe 0..1, wie sie der Server schon gerechnet hat. */
data class DiagrammPunkt(val xLabel: String, val wert: Geld, val yFrac: Double)

data class DiagrammAchse(val label: String, val wert: Geld, val frac: Double)

/** Der Verlauf des Sammlungswerts: je Tag ein Punkt, die Achse und die Veränderung im Zeitraum. */
data class WertverlaufAnsicht(
    val waehrung: Waehrung,
    val veraenderungProzent: Double?,
    val punkte: List<DiagrammPunkt>,
    val yAchse: List<DiagrammAchse>,
    val tage: List<String>,
)

data class FarbeAnsicht(val id: Int, val name: String, val hex: String?)

/** Ein Gutschein; [pin] null heisst „keine“ oder „offline nicht abgelegt“. */
data class GutscheinAnsicht(
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
data class PreisalarmAnsicht(
    val setNumber: String,
    val condition: Zustand,
    val richtung: Alarmrichtung,
    val schwelle: Geld,
    val currencyCode: Waehrung,
    val ausgeloest: Boolean,
    val zuletztAm: Instant?,
    val zuletztPreis: Geld?,
    val name: String?,
    val imageLocal: String?,
    val imageUrl: String?,
    val setImgUrl: String?,
    val besitzt: Boolean,
) {
    val unter: Boolean get() = richtung == Alarmrichtung.UNTER
}

/** Was seit der letzten Marke ausgelöst hat; [marke] ist die Zeit des Servers für die nächste Frage. */
data class AlarmabrufAnsicht(val alarme: List<PreisalarmAnsicht>, val marke: String?)
