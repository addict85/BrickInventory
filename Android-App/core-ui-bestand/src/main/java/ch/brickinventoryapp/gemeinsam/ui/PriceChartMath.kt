package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.model.util.fmtDatum

/**
 * Rechnen für das Preisdiagramm, ohne Compose und damit prüfbar. Die vom Server
 * vorne aufgefüllten Nullen heissen „kein Wert“ und werden nicht gezeichnet; die
 * x-Achse folgt dem Datum, nicht dem Index. Dieselben Regeln wie im Web
 * (public/js/admin.js, priceChartSVG).
 */

/** Ein gezeichneter Punkt: Tag als Zahl (Tage seit 1970) und Preis. */
data class ChartPointXY(val day: Long, val value: Double)

/** Eine Linie: ihr Zustand und ihre echten Punkte. */
data class ChartLine(val condition: Zustand, val points: List<ChartPointXY>)

/** Achsenbereich für das Zeichnen. */
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

/** Was TalkBack je Linie sagt: Zeitraum, Anfangs- und Endwert, Tief und Hoch. */
data class LinienZusammenfassung(
    val zustand: Zustand,
    val von: String,
    val bis: String,
    val anfang: Double,
    val ende: Double,
    val tief: Double,
    val hoch: Double,
)

object PriceChartMath {

    /**
     * Die Beschreibung des Diagramms je gezeichneter Linie — eine Zeichenfläche
     * hat sonst keine Semantik, und TalkBack übersprang den Preisverlauf.
     */
    fun zusammenfassung(
        lines: List<ChartLine>,
        locale: java.util.Locale = appNumberLocale(),
    ): List<LinienZusammenfassung> = lines.map { l ->
        val erst = l.points.minBy { it.day }
        val letzt = l.points.maxBy { it.day }
        LinienZusammenfassung(l.condition, tagText(erst.day, locale), tagText(letzt.day, locale), erst.value, letzt.value,
            l.points.minOf { it.value }, l.points.maxOf { it.value })
    }

    /** Tage seit 1970 → „31.01.2026“ bzw. „31/01/2026“, dieselbe Schreibweise wie formatDay(). */
    fun tagText(day: Long, locale: java.util.Locale): String =
        formatDay(java.time.LocalDate.ofEpochDay(day).toString(), locale)

    /**
     * ISO-Tag ("2026-01-31") in Tage seit 1970. Bewusst ohne java.time-Parsing
     * im Zeichenpfad: Der Aufruf passiert je Punkt, und ein Fehltag durch eine
     * unerwartete Zeitzone würde die Linie verschieben.
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
     * Diagrammdaten des Servers in zeichenbare Linien überführen.
     *
     * Verworfen werden: die aufgefüllten Nullen vor `firstRealIndex`, danach
     * jeder Punkt ohne Preis (y <= 0) und jede Reihe, die dann leer ist.
     */
    fun buildLines(chart: PreisDiagrammAnsicht?): List<ChartLine> {
        val series = chart?.values ?: return emptyList()
        return series.mapNotNull { s ->
            val start = s.firstRealIndex.coerceIn(0, s.values.size)
            val pts = s.values.drop(start)
                .filter { it.y > 0.0 }
                .mapNotNull { p -> dayNumber(p.x)?.let { ChartPointXY(it, p.y) } }
            if (pts.isEmpty()) null else ChartLine(Zustand.aus(s.name) ?: Zustand.NEU, pts)
        }
    }

    /**
     * Gemeinsame Skala über alle Linien, weil der Abstand zwischen Neu- und
     * Gebrauchtpreis der interessante Vergleich ist. 15 % Rand, damit keine Linie am
     * Rand klebt; gleiche Werte spannen 10 % des Wertes auf. Die Ränder landen auf
     * runden Werten (siehe [schritt]), damit die Achse 790/800/810 liest statt 787/801/816.
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
        // Eine gerade Zahl von Schritten, damit auch die Mitte auf einem runden Wert liegt.
        if (kotlin.math.round((maxValue - minValue) / s).toLong() % 2L != 0L) maxValue += s
        return ChartBounds(minDay = minDay, maxDay = maxDay, minValue = minValue, maxValue = maxValue)
    }

    /**
     * Ein runder Schritt nahe [roh]: 1, 2 oder 5 mal einer Zehnerpotenz, nie unter
     * 1 — die Achse zeigt ganze Beträge, und ein kleinerer Schritt stünde doppelt da.
     */
    fun schritt(roh: Double): Double {
        if (roh <= 1.0) return 1.0
        val potenz = Math.pow(10.0, kotlin.math.floor(kotlin.math.log10(roh)))
        val faktor = listOf(1.0, 2.0, 5.0, 10.0).first { it * potenz >= roh }
        return faktor * potenz
    }

    /** Drei Beschriftungen der Wertachse: unten, Mitte, oben — alle drei runde Werte. */
    fun yTicks(b: ChartBounds): List<Double> =
        listOf(b.minValue, (b.minValue + b.maxValue) / 2, b.maxValue)

    /**
     * "2026-01-31" → „31.01.2026“ (de) bzw. „31/01/2026“ (en) — über fmtDatum, damit
     * die Achse dieselbe Form zeigt wie das Erfassungsdatum darüber. Unbrauchbare
     * Eingaben bleiben unverändert.
     */
    fun formatDay(iso: String, locale: java.util.Locale = appNumberLocale()): String =
        fmtDatum(iso, locale) ?: iso

    /** Erster und letzter Tag der gemeinsamen Achse (für die Randbeschriftung). */
    fun axisRange(chart: PreisDiagrammAnsicht?): Pair<String, String>? {
        val x = chart?.x?.filter { it.isNotBlank() } ?: return null
        if (x.isEmpty()) return null
        return x.first() to x.last()
    }
}
