package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.PriceChartData

/**
 * Rechnen für das Preisverlauf-Diagramm — ohne Compose, damit testbar.
 *
 * ── Warum eine eigene Datei ─────────────────────────────────────────────────
 * Dasselbe Muster wie ui/CatalogYearMath.kt: Die Zahlenarbeit steckt sonst in
 * einem Canvas-Block, den kein Unit-Test aufrufen kann. Genau die Stellen, die
 * hier schiefgehen können (führende Nullen, zwei Reihen mit unterschiedlicher
 * Länge, alle Werte gleich), sind ohne Test nur am Gerät zu sehen.
 *
 * ── Die zwei Fallen ─────────────────────────────────────────────────────────
 * 1. FÜHRENDE NULLEN. Der Server füllt kürzere Reihen vorne mit 0 auf, damit
 *    alle Reihen dieselbe Länge und damit dieselbe x-Achse haben. Eine 0
 *    bedeutet „kein Wert", nicht „Preis null". Wer sie zeichnet, bekommt eine
 *    Linie, die bei null beginnt und senkrecht hochspringt — ein Kurssturz,
 *    den es nie gab. `firstRealIndex` sagt je Reihe, ab wo echte Werte stehen.
 *
 * 2. INDEXBASIERTE x-ACHSE. Gebrauchtpreise setzen für viele Sets später ein
 *    als Neupreise. Wer beide Reihen über die volle Breite streckt (i / (n-1)),
 *    legt Punkte aus verschiedenen Monaten übereinander und zeigt einen
 *    Vergleich, den es nicht gibt. Die x-Position kommt deshalb vom DATUM.
 *
 * Beides ist derselbe Stand wie in der Webapp (public/js/07-admin.js,
 * priceChartSVG) — die Regeln stehen dort im selben Wortlaut.
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

object PriceChartMath {

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
