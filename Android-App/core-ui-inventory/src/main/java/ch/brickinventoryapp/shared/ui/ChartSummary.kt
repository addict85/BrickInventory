package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.PricePoint

/**
 * What TalkBack says about the value chart: from when to when, start and
 * end value, change. A canvas otherwise has no semantics — the
 * chart was invisible to screen readers.
 */
data class ChartSummary(
    val of: String,
    val until: String,
    val begin: Double,
    val end: Double,
    val changePercent: Double?,
)

/**
 * Null as long as there is no history (fewer than two points). The
 * change comes from the server when it sends one — the same figure the
 * badge shows; only without it is it computed from start and end.
 */
fun chartSummary(points: List<PricePoint>, changeServer: Double?): ChartSummary? {
    if (points.size < 2) return null
    val begin = points.first().value.asDouble()
    val end = points.last().value.asDouble()
    val percent = changeServer
        ?: if (begin != 0.0) (end - begin) / begin * 100.0 else null
    // Not every point carries a label; the outermost ones present
    // name the time span.
    return ChartSummary(
        of = points.firstOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        until = points.lastOrNull { it.xLabel.isNotBlank() }?.xLabel.orEmpty(),
        begin = begin,
        end = end,
        changePercent = percent,
    )
}
