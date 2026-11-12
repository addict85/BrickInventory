package ch.brickinventoryapp.finanzen.ui.screens

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import ch.brickinventoryapp.ui.theme.LocalChartColors
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import ch.brickinventoryapp.model.ui.model.DiagrammAchse
import ch.brickinventoryapp.model.ui.model.DiagrammPunkt
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.gemeinsam.ui.diagrammZusammenfassung
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.SegmentWahl

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PortfolioChart(
    points: List<DiagrammPunkt>,
    yAxis: List<DiagrammAchse>,
    currency: Waehrung,
    isLoading: Boolean,
    selectedPeriod: String,
    periodChangePct: Double? = null,
    onPeriodChange: (String) -> Unit
) {
    // Alle Diagrammfarben aus dem Design, wie `new`/`used` — fest eingetragene stünden
    // in einem anderen Design als Fremdkörper neben dessen Farben.
    val chart      = LocalChartColors.current
    val lineColor  = chart.linie
    val fillStart  = chart.linie.copy(alpha = 0.18f)
    val mutedColor = chart.gedaempft
    val gridColor  = chart.raster
    val measurer   = rememberTextMeasurer()
    // Achsen in der kleinsten Rolle der Skala (11 sp) statt 8 sp; der Rand
    // links und unten richtet sich unten nach der gemessenen Beschriftung.
    val achsenStil = MaterialTheme.typography.labelSmall.copy(color = mutedColor)

    // Die Fläche der übrigen Karten: Auf dem grauen Kartenton der Vorgabe hätte die
    // Achsenschrift weniger Kontrast als überall sonst.
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(Abstaende.gross)) {
            PortfolioKopf(selectedPeriod, periodChangePct)

            Spacer(Modifier.height(Abstaende.mittel))

            when {
                isLoading -> Box(Modifier.fillMaxWidth().height(160.dp), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
                points.size < 2 -> Box(Modifier.fillMaxWidth().heightIn(min = 80.dp), Alignment.Center) {
                    Text(stringResource(R.string.chart_no_history),
                        style = MaterialTheme.typography.bodySmall, color = mutedColor)
                }
                else -> {
                    // Eine Zeichenfläche hat keine Semantik; ohne diese Zeile
                    // überspringt TalkBack das Diagramm ganz.
                    val beschreibung = diagrammZusammenfassung(points, periodChangePct)?.let { z ->
                        val von = fmtMoney(z.anfang, currency)
                        val bis = fmtMoney(z.ende, currency)
                        val prozent = z.veraenderungProzent
                        if (prozent == null) stringResource(R.string.chart_summary_no_change, z.von, z.bis, von, bis)
                        else stringResource(R.string.chart_summary, z.von, z.bis, von, bis,
                            fmtProzent(prozent))
                    }.orEmpty()

                    Canvas(Modifier.fillMaxWidth().height(160.dp).semantics { contentDescription = beschreibung }) {
                        zeichneVerlauf(points, yAxis, measurer, achsenStil, VerlaufFarben(lineColor, fillStart, gridColor))
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // Zeitraum: eine Einfachwahl, darum Segmente wie überall (SegmentWahl).
            SegmentWahl(
                optionen = listOf(
                    "week" to stringResource(R.string.chart_period_week),
                    "month" to stringResource(R.string.chart_period_month),
                    "year" to stringResource(R.string.chart_period_year),
                    "max" to stringResource(R.string.chart_period_max)
                ),
                gewaehlt = selectedPeriod,
                onWahl = onPeriodChange,
            )
        }
    }
}

/** Titel und Veränderung im Zeitraum; bei grosser Schrift rückt die Plakette darunter. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PortfolioKopf(selectedPeriod: String, periodChangePct: Double?) {
    FlowRow(Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        Text(stringResource(R.string.chart_portfolio_value),
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.titleSmall)
        if (periodChangePct != null) {
            val pos = periodChangePct >= 0
            val bg  = if (pos) LocalStatusFarben.current.erfolg else LocalStatusFarben.current.fehler
            // Mit Zeitraum: „+1.3 %“ allein stand neben „G&V +14.2 %“ darunter und
            // sagte nicht, dass es nur um diese Woche geht.
            val lbl = stringResource(when (selectedPeriod) {
                "month" -> R.string.chart_change_month
                "year" -> R.string.chart_change_year
                "max" -> R.string.chart_change_max
                else -> R.string.chart_change_week
            }, fmtProzent(periodChangePct))
            Surface(shape = Formen.chip, color = bg.copy(alpha = 0.12f)) {
                Text(lbl, Modifier.padding(horizontal = Abstaende.klein, vertical = 3.dp),
                    color = bg, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

/** Die drei Farben des Verlaufs aus dem Design: Linie, Fläche darunter, Raster. */
private class VerlaufFarben(val linie: Color, val flaeche: Color, val raster: Color)

/** Raster, Achsen, Fläche, Linie und Punkte; die Höhe jedes Punkts rechnet der Server (y_frac). */
private fun DrawScope.zeichneVerlauf(
    points: List<DiagrammPunkt>,
    yAxis: List<DiagrammAchse>,
    measurer: TextMeasurer,
    achsenStil: TextStyle,
    farben: VerlaufFarben,
) {
    val yMasse = yAxis.map { measurer.measure(it.label, achsenStil) }
    val padL = (yMasse.maxOfOrNull { it.size.width } ?: 0) + 8f
    val padR = 16f
    val padT = 14f
    val padB = measurer.measure("0", achsenStil).size.height + 10f
    val r = Rahmen(padL, padT, size.width - padL - padR, size.height - padT - padB, points.size)
    zeichneYAchse(yAxis, yMasse, r, farben.raster)
    // Die Daten unter der Fläche, nie links neben ihr: Die erste steht
    // bündig am Anfang, die letzte am Ende, damit keine in die Spalte
    // der Beträge links ragt.
    points.forEachIndexed { i, p ->
        if (p.xLabel.isEmpty()) return@forEachIndexed
        val m = measurer.measure(p.xLabel, achsenStil)
        val links = when (i) {
            0 -> r.links
            points.size - 1 -> r.links + r.breite - m.size.width
            else -> r.x(i) - m.size.width / 2f
        }.coerceIn(r.links, (size.width - m.size.width).coerceAtLeast(r.links))
        drawText(m, topLeft = Offset(links, size.height - padB + 5f))
    }
    zeichneLinie(points, r, farben)
}

/** Die Zeichenfläche ohne Ränder: wo Punkt i steht und wie hoch ein y_frac des Servers liegt (0 unten, 1 oben). */
private class Rahmen(val links: Float, val oben: Float, val breite: Float, val hoehe: Float, private val n: Int) {
    val unten: Float get() = oben + hoehe
    fun x(i: Int) = links + (if (n == 1) breite / 2f else i.toFloat() / (n - 1) * breite)
    fun y(yFrac: Double) = (oben + hoehe - yFrac.toFloat() * hoehe)
}

/** Gestrichelte Rasterlinien und die Beträge links daneben (der Server schickt fünf, Index 0 unten). */
private fun DrawScope.zeichneYAchse(yAxis: List<DiagrammAchse>, yMasse: List<TextLayoutResult>, r: Rahmen, raster: Color) {
    yAxis.forEachIndexed { i, ya ->
        val y = r.y(ya.frac)
        var xd = r.links
        while (xd < r.links + r.breite) {
            drawLine(raster, Offset(xd, y),
                Offset((xd + 3f).coerceAtMost(r.links + r.breite), y), 0.8f)
            xd += 6f
        }
        // Rechtsbündig und nie unter die Grundlinie: Die unterste
        // Beschriftung ragte sonst in die Zeile der Daten darunter.
        val m = yMasse[i]
        val oben = (y - m.size.height / 2f).coerceIn(0f, r.unten - m.size.height)
        drawText(m, topLeft = Offset(r.links - m.size.width - 4f, oben))
    }
}

/** Die Fläche unter der Linie im Verlauf, die Linie und die Punkte; der letzte hervorgehoben. */
private fun DrawScope.zeichneLinie(points: List<DiagrammPunkt>, r: Rahmen, farben: VerlaufFarben) {
    val n = points.size
    val fp = Path().apply {
        moveTo(r.x(0), r.unten)
        points.forEachIndexed { i, p -> lineTo(r.x(i), r.y(p.yFrac)) }
        lineTo(r.x(n - 1), r.unten)
        close()
    }
    drawPath(fp, Brush.verticalGradient(
        listOf(farben.flaeche, Color.Transparent), startY = r.oben, endY = r.unten))
    val lp = Path().apply {
        points.forEachIndexed { i, p ->
            if (i == 0) moveTo(r.x(i), r.y(p.yFrac))
            else        lineTo(r.x(i), r.y(p.yFrac))
        }
    }
    drawPath(lp, farben.linie,
        style = Stroke(2.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    points.forEachIndexed { i, p ->
        val cx = r.x(i); val cy = r.y(p.yFrac)
        if (i == n - 1) {
            drawCircle(Color.White, 5.5f, Offset(cx, cy))
            drawCircle(farben.linie, 4f, Offset(cx, cy))
        } else {
            drawCircle(farben.linie.copy(alpha = 0.4f), 2.5f, Offset(cx, cy))
        }
    }
}
