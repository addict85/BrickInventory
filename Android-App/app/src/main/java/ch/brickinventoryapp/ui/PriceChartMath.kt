package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.PriceChartData

/**
 * Rechnen für das Preisverlauf-Diagramm — ohne Compose, damit testbar (wie
 * ui/CatalogYearMath.kt). In einem Canvas-Block wären die Fallen nur am Gerät zu
 * sehen:
 *
 * 1. Führende Nullen. Der Server füllt kürzere Reihen vorne mit 0 auf, damit alle
 *    dieselbe x-Achse haben; 0 heisst „kein Wert“, nicht „Preis null“. Gezeichnet
 *    ergäbe sie einen Kurssturz, den es nie gab. `firstRealIndex` sagt je Reihe,
 *    ab wo echte Werte stehen.
 *
 * 2. Die x-Achse kommt vom Datum, nicht vom Index: Gebrauchtpreise setzen oft
 *    später ein als Neupreise, und über die volle Breite gestreckt lägen Punkte
 *    aus verschiedenen Monaten übereinander.
 *
 * Dieselben Regeln wie in der Webapp (public/js/07-admin.js, priceChartSVG).
 */

/** Ein gezeichneter Punkt: Tag als Zahl (Tage seit 1970) und Preis. */
data class ChartPointXY(val day: Long, val value: Double)

/** Eine Linie: Zustand ('N'/'U') und ihre echten Punkte. */
data class ChartLine(val condition: String, val points: List<ChartPointXY>)

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
    val zustand: String,
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
    fun zusammenfassung(lines: List<ChartLine>): List<LinienZusammenfassung> = lines.map { l ->
        val erst = l.points.minBy { it.day }
        val letzt = l.points.maxBy { it.day }
        LinienZusammenfassung(l.condition, tagText(erst.day), tagText(letzt.day), erst.value, letzt.value,
            l.points.minOf { it.value }, l.points.maxOf { it.value })
    }

    /** Tage seit 1970 → "31.1.2026", dieselbe Schreibweise wie formatDay(). */
    fun tagText(day: Long): String =
        java.time.LocalDate.ofEpochDay(day).let { "${it.dayOfMonth}.${it.monthValue}.${it.year}" }

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
    fun buildLines(chart: PriceChartData?): List<ChartLine> {
        val series = chart?.values ?: return emptyList()
        return series.mapNotNull { s ->
            val start = s.firstRealIndex.coerceIn(0, s.values.size)
            val pts = s.values.drop(start)
                .filter { it.y > 0.0 }
                .mapNotNull { p -> dayNumber(p.x)?.let { ChartPointXY(it, p.y) } }
            if (pts.isEmpty()) null else ChartLine(s.name, pts)
        }
    }

    /**
     * Gemeinsame Skala über ALLE Linien.
     *
     * Bewusst gemeinsam und nicht je Linie: Der interessante Vergleich ist der
     * Abstand zwischen Neu- und Gebrauchtpreis und wie er sich entwickelt;
     * getrennte Skalen machen genau das unsichtbar.
     *
     * Der Rand von 15 % verhindert, dass die Linie am oberen oder unteren Rand
     * klebt; sind alle Werte gleich, wird stattdessen um 10 % des Wertes
     * aufgespannt (sonst wäre die Spanne 0 und die Linie läge im Nichts).
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
        return ChartBounds(
            minDay = minDay, maxDay = maxDay,
            minValue = (rawMin - pad).coerceAtLeast(0.0),
            maxValue = rawMax + pad,
        )
    }

    /** Drei Beschriftungen der Wertachse: unten, Mitte, oben. */
    fun yTicks(b: ChartBounds): List<Double> =
        listOf(b.minValue, (b.minValue + b.maxValue) / 2, b.maxValue)

    /** "2026-01-31" → "31.1.2026"; unbrauchbare Eingaben bleiben unverändert. */
    fun formatDay(iso: String): String {
        val p = iso.take(10).split("-")
        if (p.size != 3) return iso
        val d = p[2].toIntOrNull() ?: return iso
        val m = p[1].toIntOrNull() ?: return iso
        return "$d.$m.${p[0]}"
    }

    /** Erster und letzter Tag der gemeinsamen Achse (für die Randbeschriftung). */
    fun axisRange(chart: PriceChartData?): Pair<String, String>? {
        val x = chart?.x?.filter { it.isNotBlank() } ?: return null
        if (x.isEmpty()) return null
        return x.first() to x.last()
    }
}
