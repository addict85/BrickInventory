package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.PreisDiagrammAnsicht
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.model.util.fmtDatum

/**
 * Computation for the price chart, without Compose and thus testable. The zeros
 * the server pads at the front mean „no value“ and are not drawn; the
 * x-axis follows the date, not the index. The same rules as on the web
 * (public/js/admin.js, priceChartSVG).
 */

/** A drawn point: day as a number (days since 1970) and price. */
data class ChartPointXY(val day: Long, val value: Double)

/** A line: its condition and its real points. */
data class ChartLine(val condition: Zustand, val points: List<ChartPointXY>)

/** Axis range for drawing. */
data class ChartBounds(
    val minDay: Long, val maxDay: Long,
    val minValue: Double, val maxValue: Double,
) {
    val daySpan: Long get() = (maxDay - minDay).coerceAtLeast(1L)
    val valueSpan: Double get() = (maxValue - minValue).takeIf { it > 0 } ?: 1.0

    /** Waagerechte Position 0..1. */
    fun xFraction(day: Long): Float = ((day - minDay).toDouble() / daySpan).toFloat()

    /** Senkrechte Position 0..1, von OBEN gemessen (Canvas-Richtung). */
    fun yFraction(value: Double): Float = (1.0 - (value - minValue) / valueSpan).toFloat()
}

/** What TalkBack says per line: time span, start and end value, low and high. */
data class LinesSummary(
    val zustand: Zustand,
    val von: String,
    val bis: String,
    val anfang: Double,
    val ende: Double,
    val deep: Double,
    val hoch: Double,
)

object PriceChartMath {

    /**
     * The chart's description per drawn line — a canvas otherwise
     * has no semantics, and TalkBack skipped the price history.
     */
    fun zusammenfassung(
        lines: List<ChartLine>,
        locale: java.util.Locale = appNumberLocale(),
    ): List<LinesSummary> = lines.map { l ->
        val erst = l.points.minBy { it.day }
        val letzt = l.points.maxBy { it.day }
        LinesSummary(l.condition, tagText(erst.day, locale), tagText(letzt.day, locale), erst.value, letzt.value,
            l.points.minOf { it.value }, l.points.maxOf { it.value })
    }

    /** Days since 1970 → „31.01.2026“ resp. „31/01/2026“, the same notation as formatDay(). */
    fun tagText(day: Long, locale: java.util.Locale): String =
        formatDay(java.time.LocalDate.ofEpochDay(day).toString(), locale)

    /**
     * ISO day ("2026-01-31") into days since 1970. Deliberately without java.time parsing
     * in the drawing path: the call happens per point, and a wrong day from an
     * unexpected time zone would shift the line.
     */
    fun dayNumber(iso: String): Long? {
        val p = iso.take(10).split("-")
        if (p.size != 3) return null
        val y = p[0].toIntOrNull() ?: return null
        val m = p[1].toIntOrNull() ?: return null
        val d = p[2].toIntOrNull() ?: return null
        return runCatching { java.time.LocalDate.of(y, m, d).toEpochDay() }.getOrNull()
    }

    /**
     * Turn the server's chart data into drawable lines.
     *
     * Discarded are: the padded zeros before `firstRealIndex`, after that
     * every point without a price (preis <= 0), and every series that is then empty.
     */
    fun buildLines(chart: PreisDiagrammAnsicht?): List<ChartLine> {
        val series = chart?.values ?: return emptyList()
        return series.mapNotNull { s ->
            val start = s.firstRealIndex.coerceIn(0, s.values.size)
            val pts = s.values.drop(start)
                .filter { it.preis.positive }
                .mapNotNull { p -> dayNumber(p.x)?.let { ChartPointXY(it, p.preis.asDouble()) } }
            if (pts.isEmpty()) null else ChartLine(Zustand.aus(s.name) ?: Zustand.NEU, pts)
        }
    }

    /**
     * A shared scale across all lines, because the gap between new and
     * used price is the interesting comparison. 15% margin, so no line sticks to the
     * edge; equal values span 10% of the value. The edges land on
     * round values (see [schritt]), so the axis reads 790/800/810 instead of 787/801/816.
     */
    fun bounds(lines: List<ChartLine>): ChartBounds? {
        val pts = lines.flatMap { it.points }
        if (pts.isEmpty()) return null
        val minDay = pts.minOf { it.day }
        val maxDay = pts.maxOf { it.day }
        val rawMin = pts.minOf { it.value }
        val rawMax = pts.maxOf { it.value }
        val spread = rawMax - rawMin
        val pad = if (spread > 0) spread * 0.15 else (rawMax * 0.1).takeIf { it > 0 } ?: 1.0
        val unten = (rawMin - pad).coerceAtLeast(0.0)
        val oben = rawMax + pad
        val s = schritt((oben - unten) / 4)
        val minValue = kotlin.math.floor(unten / s) * s
        var maxValue = kotlin.math.ceil(oben / s) * s
        // An even number of steps, so the middle too lands on a round value.
        if (kotlin.math.round((maxValue - minValue) / s).toLong() % 2L != 0L) maxValue += s
        return ChartBounds(minDay = minDay, maxDay = maxDay, minValue = minValue, maxValue = maxValue)
    }

    /**
     * A round step near [roh]: 1, 2 or 5 times a power of ten, never below
     * 1 — the axis shows whole amounts, and a smaller step would be shown twice over.
     */
    fun schritt(roh: Double): Double {
        if (roh <= 1.0) return 1.0
        val power = Math.pow(10.0, kotlin.math.floor(kotlin.math.log10(roh)))
        val faktor = listOf(1.0, 2.0, 5.0, 10.0).first { it * power >= roh }
        return faktor * power
    }

    /** Three labels on the value axis: bottom, middle, top — all three round values. */
    fun yTicks(b: ChartBounds): List<Double> =
        listOf(b.minValue, (b.minValue + b.maxValue) / 2, b.maxValue)

    /**
     * "2026-01-31" → „31.01.2026“ (de) resp. „31/01/2026“ (en) — via fmtDatum, so
     * the axis shows the same form as the capture date above it. Unusable
     * input stays unchanged.
     */
    fun formatDay(iso: String, locale: java.util.Locale = appNumberLocale()): String =
        fmtDatum(iso, locale) ?: iso

    /** First and last day of the shared axis (for the edge labels). */
    fun axisRange(chart: PreisDiagrammAnsicht?): Pair<String, String>? {
        val x = chart?.x?.filter { it.isNotBlank() } ?: return null
        if (x.isEmpty()) return null
        return x.first() to x.last()
    }
}
