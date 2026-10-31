package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.data.model.BrickColor
import ch.brickinventoryapp.data.model.ChartPoint
import ch.brickinventoryapp.data.model.ChartYAxis
import ch.brickinventoryapp.data.model.CsvArt
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.data.model.StartupStatus

/** „Keine Farbe“ für die Oberfläche — derselbe Wert wie im Server-Modell, ein Name. */
const val OHNE_FARBE: Int = KEINE_FARBE

/**
 * Was der CSV-Import anbietet. Eine eigene Aufzählung, damit die Auswahl in der
 * Oberfläche nicht am Server-Modell hängt; [alsDaten] übersetzt beim Hochladen.
 */
enum class CsvImportArt { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }

fun CsvImportArt.alsDaten(): CsvArt = when (this) {
    CsvImportArt.SETS -> CsvArt.SETS
    CsvImportArt.TEILE -> CsvArt.TEILE
    CsvImportArt.MINIFIGUREN -> CsvArt.MINIFIGUREN
    CsvImportArt.MERKLISTE -> CsvArt.MERKLISTE
    CsvImportArt.PREISALARME -> CsvArt.PREISALARME
}

fun CsvArt.alsAnsicht(): CsvImportArt = CsvImportArt.valueOf(name)

/** Startzustand des Servers; [anteil] ist schon gerechnet (0..1), null ohne Gesamtzahl. */
data class StartzustandAnsicht(
    val bereit: Boolean,
    val schritt: String?,
    val unterschritt: String?,
    val fortschritt: Int,
    val gesamt: Int,
) {
    val anteil: Float? get() = if (gesamt > 0) (fortschritt.toFloat() / gesamt).coerceIn(0f, 1f) else null
}

fun StartupStatus.alsAnsicht() = StartzustandAnsicht(bereit = ready, schritt = step, unterschritt = sub,
    fortschritt = progress, gesamt = total)

/** Ein Punkt der Wertentwicklung; [yFrac] ist die Höhe 0..1, wie sie der Server schon gerechnet hat. */
data class DiagrammPunkt(val xLabel: String, val value: Double, val yFrac: Double)

data class DiagrammAchse(val label: String, val value: Double, val frac: Double)

fun ChartPoint.alsAnsicht() = DiagrammPunkt(xLabel, value, yFrac)
fun ChartYAxis.alsAnsicht() = DiagrammAchse(label, value, frac)

data class FarbeAnsicht(val id: Int, val name: String, val hex: String?)

fun BrickColor.alsAnsicht() = FarbeAnsicht(id, name, hex)

/** Ein Gutschein; [pin] null heisst „keine“ oder „offline nicht abgelegt“. */
data class GutscheinAnsicht(
    val id: Int,
    val number: String,
    val pin: String?,
    val amount: Double,
    val currency: String,
    val hatPdf: Boolean,
    val createdAt: String?,
    val guthabenGeprueftAm: String?,
)

fun Gutschein.alsAnsicht() = GutscheinAnsicht(id, number, pin, amount, currency, hatPdf, createdAt, guthabenGeprueftAm)

/** Ein Preisalarm; [unter] ist die Richtung als Wahrheitswert statt als Wort. */
data class PreisalarmAnsicht(
    val setNumber: String,
    val condition: String,
    val richtung: String,
    val schwelle: Double,
    val currencyCode: String,
    val ausgeloest: Boolean,
    val zuletztAm: String?,
    val zuletztPreis: Double?,
    val name: String?,
    val imageLocal: String?,
    val imageUrl: String?,
    val setImgUrl: String?,
    val besitzt: Boolean,
) {
    val unter: Boolean get() = richtung == "unter"
}

fun Preisalarm.alsAnsicht() = PreisalarmAnsicht(setNumber, condition, richtung, schwelle, currencyCode, ausgeloest,
    zuletztAm, zuletztPreis, name, imageLocal, imageUrl, setImgUrl, besitzt)
