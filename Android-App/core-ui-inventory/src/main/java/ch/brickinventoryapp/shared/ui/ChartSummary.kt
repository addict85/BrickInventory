package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.DiagrammPunkt

/**
 * Was TalkBack über das Wertdiagramm sagt: von wann bis wann, Anfangs- und
 * Endwert, Veränderung. Eine Zeichenfläche hat sonst keine Semantik — das
 * Diagramm war für Vorleseprogramme unsichtbar.
 */
data class ChartSummary(
    val von: String,
    val bis: String,
    val anfang: Double,
    val ende: Double,
    val changePercent: Double?,
)

/**
 * Null, solange es keinen Verlauf gibt (weniger als zwei Punkte). Die
 * Veränderung kommt vom Server, wenn er sie schickt — dieselbe Zahl, die die
 * Plakette zeigt; nur ohne sie wird aus Anfang und Ende gerechnet.
 */
fun chartSummary(punkte: List<DiagrammPunkt>, changeServer: Double?): ChartSummary? {
    if (punkte.size < 2) return null
    val anfang = punkte.first().wert.asDouble()
    val ende = punkte.last().wert.asDouble()
    val prozent = changeServer
        ?: if (anfang != 0.0) (ende - anfang) / anfang * 100.0 else null
    // Nicht jeder Punkt trägt eine Beschriftung; die äussersten vorhandenen
    // benennen den Zeitraum.
    return ChartSummary(
        von = punkte.firstOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        bis = punkte.lastOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        anfang = anfang,
        ende = ende,
        changePercent = prozent,
    )
}
