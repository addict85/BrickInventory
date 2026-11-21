package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.DiagrammPunkt

/**
 * What TalkBack says about the value chart: from when to when, start and
 * end value, change. A canvas otherwise has no semantics — the
 * chart was invisible to screen readers.
 */
data class ChartSummary(
    val von: String,
    val bis: String,
    val anfang: Double,
    val ende: Double,
    val changePercent: Double?,
)

/**
 * Null as long as there is no history (fewer than two points). The
 * change comes from the server when it sends one — the same figure the
 * badge shows; only without it is it computed from start and end.
 */
fun chartSummary(punkte: List<DiagrammPunkt>, changeServer: Double?): ChartSummary? {
    if (punkte.size < 2) return null
    val anfang = punkte.first().wert.asDouble()
    val ende = punkte.last().wert.asDouble()
    val prozent = changeServer
        ?: if (anfang != 0.0) (ende - anfang) / anfang * 100.0 else null
    // Not every point carries a label; the outermost ones present
    // name the time span.
    return ChartSummary(
        von = punkte.firstOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        bis = punkte.lastOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        anfang = anfang,
        ende = ende,
        changePercent = prozent,
    )
}
