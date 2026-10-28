package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.ChartPoint

/**
 * Was TalkBack über das Wertdiagramm sagt: von wann bis wann, Anfangs- und
 * Endwert, Veränderung. Eine Zeichenfläche hat sonst keine Semantik — das
 * Diagramm war für Vorleseprogramme unsichtbar.
 */
data class DiagrammZusammenfassung(
    val von: String,
    val bis: String,
    val anfang: Double,
    val ende: Double,
    val veraenderungProzent: Double?,
)

/**
 * Null, solange es keinen Verlauf gibt (weniger als zwei Punkte). Die
 * Veränderung kommt vom Server, wenn er sie schickt — dieselbe Zahl, die die
 * Plakette zeigt; nur ohne sie wird aus Anfang und Ende gerechnet.
 */
fun diagrammZusammenfassung(punkte: List<ChartPoint>, veraenderungServer: Double?): DiagrammZusammenfassung? {
    if (punkte.size < 2) return null
    val anfang = punkte.first().value
    val ende = punkte.last().value
    val prozent = veraenderungServer
        ?: if (anfang != 0.0) (ende - anfang) / anfang * 100.0 else null
    // Nicht jeder Punkt trägt eine Beschriftung; die äussersten vorhandenen
    // benennen den Zeitraum.
    return DiagrammZusammenfassung(
        von = punkte.firstOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        bis = punkte.lastOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        anfang = anfang,
        ende = ende,
        veraenderungProzent = prozent,
    )
}
