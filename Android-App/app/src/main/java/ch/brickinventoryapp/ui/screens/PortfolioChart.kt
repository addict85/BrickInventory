package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import ch.brickinventoryapp.ui.theme.LocalChartColors
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import ch.brickinventoryapp.data.model.ChartPoint
import ch.brickinventoryapp.data.model.ChartYAxis
import ch.brickinventoryapp.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PortfolioChart(
    points: List<ChartPoint>,
    yAxis: List<ChartYAxis>,
    currency: String,
    isLoading: Boolean,
    selectedPeriod: String,
    periodChangePct: Double? = null,
    onPeriodChange: (String) -> Unit
) {
    // Aus dem Design statt fest eingetragen (Nachtrag 120) — `new`/`used`
    // kamen hier schon von dort, die vier hier nicht, und im Stein-Design
    // stand deshalb ein Preussischblau neben Salbeigrün und Sand.
    val chart      = LocalChartColors.current
    val lineColor  = chart.linie
    val fillStart  = chart.linie.copy(alpha = 0.18f)
    val mutedColor = chart.gedaempft
    val gridColor  = chart.raster
    val measurer   = rememberTextMeasurer()

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {

            // Header
            Row(Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chart_portfolio_value),
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.titleSmall)
                if (periodChangePct != null) {
                    val pos = periodChangePct >= 0
                    val bg  = if (pos) LocalStatusFarben.current.erfolg else LocalStatusFarben.current.fehler
                    val lbl = if (pos) "+%.1f%%".format(periodChangePct) else "%.1f%%".format(periodChangePct)
                    Surface(shape = Formen.chip, color = bg.copy(alpha = 0.12f)) {
                        Text(lbl, Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            color = bg, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            when {
                isLoading -> Box(Modifier.fillMaxWidth().height(160.dp), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
                points.size < 2 -> Box(Modifier.fillMaxWidth().height(80.dp), Alignment.Center) {
                    Text(stringResource(R.string.chart_no_history),
                        style = MaterialTheme.typography.bodySmall, color = mutedColor)
                }
                else -> {
                    val n = points.size

                    Canvas(Modifier.fillMaxWidth().height(160.dp)) {
                        val w    = size.width
                        val h    = size.height
                        val padL = 92f
                        val padR = 16f
                        val padT = 14f
                        val padB = 32f
                        val iw   = w - padL - padR
                        val ih   = h - padT - padB

                        // X position for point i
                        fun xOf(i: Int) = padL + (if (n == 1) iw/2f else i.toFloat()/(n-1)*iw)
                        // Y position from server y_frac (0=bottom, 1=top)
                        fun yOf(yFrac: Double) = (padT + ih - yFrac.toFloat() * ih)

                        // Y axis: grid lines + labels (server provides 5 entries, index 0=bottom)
                        for (ya in yAxis) {
                            val y = yOf(ya.frac)
                            // Dashed grid line
                            var xd = padL
                            while (xd < padL + iw) {
                                drawLine(gridColor, Offset(xd, y),
                                    Offset((xd+3f).coerceAtMost(padL+iw), y), 0.8f)
                                xd += 6f
                            }
                            // Y label right-aligned
                            val style = TextStyle(fontSize = 8.sp, color = mutedColor)
                            val m = measurer.measure(ya.label, style)
                            drawText(m, topLeft = Offset(padL - m.size.width - 4f, y - m.size.height/2f))
                        }

                        // X labels from server (empty string = no label)
                        points.forEachIndexed { i, p ->
                            if (p.xLabel.isEmpty()) return@forEachIndexed
                            val style = TextStyle(fontSize = 8.sp, color = mutedColor)
                            val m = measurer.measure(p.xLabel, style)
                            drawText(m, topLeft = Offset(
                                (xOf(i) - m.size.width/2f).coerceIn(0f, w - m.size.width.toFloat()),
                                h - padB + 5f))
                        }

                        // Gradient fill
                        val fp = Path().apply {
                            moveTo(xOf(0), padT + ih)
                            points.forEachIndexed { i, p -> lineTo(xOf(i), yOf(p.yFrac)) }
                            lineTo(xOf(n-1), padT + ih)
                            close()
                        }
                        drawPath(fp, Brush.verticalGradient(
                            listOf(fillStart, Color.Transparent), startY = padT, endY = padT+ih))

                        // Line
                        val lp = Path().apply {
                            points.forEachIndexed { i, p ->
                                if (i == 0) moveTo(xOf(i), yOf(p.yFrac))
                                else        lineTo(xOf(i), yOf(p.yFrac))
                            }
                        }
                        drawPath(lp, lineColor,
                            style = Stroke(2.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))

                        // Dots
                        points.forEachIndexed { i, p ->
                            val cx = xOf(i); val cy = yOf(p.yFrac)
                            if (i == n-1) {
                                drawCircle(Color.White, 5.5f, Offset(cx, cy))
                                drawCircle(lineColor, 4f, Offset(cx, cy))
                            } else {
                                drawCircle(lineColor.copy(alpha = 0.4f), 2.5f, Offset(cx, cy))
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // Period selector
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(
                    "week" to stringResource(R.string.chart_period_week),
                    "month" to stringResource(R.string.chart_period_month),
                    "year" to stringResource(R.string.chart_period_year),
                    "max" to stringResource(R.string.chart_period_max)
                ).forEach { (p, label) ->
                    FilterChip(
                        selected  = selectedPeriod == p,
                        onClick   = { onPeriodChange(p) },
                        label     = { Text(label, fontSize = 11.sp) },
                        modifier  = Modifier.height(28.dp)
                    )
                }
            }
        }
    }
}
