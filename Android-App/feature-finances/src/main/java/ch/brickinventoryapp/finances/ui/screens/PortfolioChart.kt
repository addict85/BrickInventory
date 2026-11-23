package ch.brickinventoryapp.finances.ui.screens

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.PricePoint
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.chartSummary
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.theme.LocalChartColors
import ch.brickinventoryapp.ui.theme.LocalStatusColors
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtPercent

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PortfolioChart(
    points: List<PricePoint>,
    yAxis: List<ChartAxis>,
    currency: CurrencyCode,
    isLoading: Boolean,
    selectedPeriod: String,
    periodChangePct: Double? = null,
    onPeriodChange: (String) -> Unit
) {
    // All chart colors from the theme, like `new`/`used` — hardcoded ones would
    // stand out as foreign bodies next to another theme's colors.
    val chart      = LocalChartColors.current
    val lineColor  = chart.line
    val fillStart  = chart.line.copy(alpha = 0.18f)
    val mutedColor = chart.muted
    val gridColor  = chart.raster
    val measurer   = rememberTextMeasurer()
    // Axes at the smallest role of the type scale (11 sp) instead of 8 sp; the margin
    // on the left and bottom is set by the measured label below.
    val axesStyle = MaterialTheme.typography.labelSmall.copy(color = mutedColor)

    // The surface of the other cards: on the default gray card tone, the
    // axis text would have less contrast than everywhere else.
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(Spacing.large)) {
            PortfolioHeader(selectedPeriod, periodChangePct)

            Spacer(Modifier.height(Spacing.medium))

            when {
                isLoading -> Box(Modifier.fillMaxWidth().height(160.dp), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
                points.size < 2 -> Box(Modifier.fillMaxWidth().heightIn(min = 80.dp), Alignment.Center) {
                    Text(stringResource(R.string.chart_no_history),
                        style = MaterialTheme.typography.bodySmall, color = mutedColor)
                }
                else -> {
                    // A drawing surface has no semantics; without this line
                    // TalkBack skips the chart entirely.
                    val description = chartSummary(points, periodChangePct)?.let { z ->
                        val of = fmtMoney(z.begin, currency)
                        val until = fmtMoney(z.end, currency)
                        val percent = z.changePercent
                        if (percent == null) stringResource(R.string.chart_summary_no_change, z.of, z.until, of, until)
                        else stringResource(R.string.chart_summary, z.of, z.until, of, until,
                            fmtPercent(percent))
                    }.orEmpty()

                    Canvas(Modifier.fillMaxWidth().height(160.dp).semantics { contentDescription = description }) {
                        drawHistory(points, yAxis, measurer, axesStyle, HistoryColors(lineColor, fillStart, gridColor))
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // Period: a single choice, hence segments as everywhere (SegmentChoice).
            SegmentChoice(
                options = listOf(
                    "week" to stringResource(R.string.chart_period_week),
                    "month" to stringResource(R.string.chart_period_month),
                    "year" to stringResource(R.string.chart_period_year),
                    "max" to stringResource(R.string.chart_period_max)
                ),
                chosen = selectedPeriod,
                onChoice = onPeriodChange,
            )
        }
    }
}

/** Title and change over the period; at large font the badge moves underneath. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PortfolioHeader(selectedPeriod: String, periodChangePct: Double?) {
    FlowRow(Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        Text(stringResource(R.string.chart_portfolio_value),
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.titleSmall)
        if (periodChangePct != null) {
            val pos = periodChangePct >= 0
            val bg  = if (pos) LocalStatusColors.current.success else LocalStatusColors.current.error
            // With a period: „+1.3 %“ alone stood next to „G&V +14.2 %“ below and
            // did not say that it was only about this week.
            val lbl = stringResource(when (selectedPeriod) {
                "month" -> R.string.chart_change_month
                "year" -> R.string.chart_change_year
                "max" -> R.string.chart_change_max
                else -> R.string.chart_change_week
            }, fmtPercent(periodChangePct))
            Surface(shape = Shapes.chip, color = bg.copy(alpha = 0.12f)) {
                Text(lbl, Modifier.padding(horizontal = Spacing.small, vertical = 3.dp),
                    color = bg, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

/** The history's three colors from the theme: line, area beneath, grid. */
private class HistoryColors(val line: Color, val surface: Color, val raster: Color)

/** Grid, axes, area, line and points; the height of each point is computed by the server (y_frac). */
private fun DrawScope.drawHistory(
    points: List<PricePoint>,
    yAxis: List<ChartAxis>,
    measurer: TextMeasurer,
    axesStyle: TextStyle,
    colors: HistoryColors,
) {
    val yDimensions = yAxis.map { measurer.measure(it.label, axesStyle) }
    val padL = (yDimensions.maxOfOrNull { it.size.width } ?: 0) + 8f
    val padR = 16f
    val padT = 14f
    val padB = measurer.measure("0", axesStyle).size.height + 10f
    val r = Frame(padL, padT, size.width - padL - padR, size.height - padT - padB, points.size)
    drawYAxis(yAxis, yDimensions, r, colors.raster)
    // The data labels under the area, never to the left of it: the first stands
    // flush at the start, the last at the end, so that none juts into the
    // column of amounts on the left.
    points.forEachIndexed { i, p ->
        if (p.xLabel.isEmpty()) return@forEachIndexed
        val m = measurer.measure(p.xLabel, axesStyle)
        val links = when (i) {
            0 -> r.links
            points.size - 1 -> r.links + r.width - m.size.width
            else -> r.x(i) - m.size.width / 2f
        }.coerceIn(r.links, (size.width - m.size.width).coerceAtLeast(r.links))
        drawText(m, topLeft = Offset(links, size.height - padB + 5f))
    }
    drawLine(points, r, colors)
}

/** The drawing surface without margins: where point i stands and how high a server y_frac lies (0 at the bottom, 1 at the top). */
private class Frame(val links: Float, val top: Float, val width: Float, val height: Float, private val n: Int) {
    val bottom: Float get() = top + height
    fun x(i: Int) = links + (if (n == 1) width / 2f else i.toFloat() / (n - 1) * width)
    fun y(yFrac: Double) = (top + height - yFrac.toFloat() * height)
}

/** Dashed grid lines and the amounts next to them on the left (the server sends five, index 0 at the bottom). */
private fun DrawScope.drawYAxis(yAxis: List<ChartAxis>, yDimensions: List<TextLayoutResult>, r: Frame, raster: Color) {
    yAxis.forEachIndexed { i, ya ->
        val y = r.y(ya.frac)
        var xd = r.links
        while (xd < r.links + r.width) {
            drawLine(raster, Offset(xd, y),
                Offset((xd + 3f).coerceAtMost(r.links + r.width), y), 0.8f)
            xd += 6f
        }
        // Right-aligned and never below the baseline: the bottommost
        // label otherwise jutted into the data row below it.
        val m = yDimensions[i]
        val top = (y - m.size.height / 2f).coerceIn(0f, r.bottom - m.size.height)
        drawText(m, topLeft = Offset(r.links - m.size.width - 4f, top))
    }
}

/** The area under the line in the history, the line and the points; the last one highlighted. */
private fun DrawScope.drawLine(points: List<PricePoint>, r: Frame, colors: HistoryColors) {
    val n = points.size
    val fp = Path().apply {
        moveTo(r.x(0), r.bottom)
        points.forEachIndexed { i, p -> lineTo(r.x(i), r.y(p.yFrac)) }
        lineTo(r.x(n - 1), r.bottom)
        close()
    }
    drawPath(fp, Brush.verticalGradient(
        listOf(colors.surface, Color.Transparent), startY = r.top, endY = r.bottom))
    val lp = Path().apply {
        points.forEachIndexed { i, p ->
            if (i == 0) moveTo(r.x(i), r.y(p.yFrac))
            else        lineTo(r.x(i), r.y(p.yFrac))
        }
    }
    drawPath(lp, colors.line,
        style = Stroke(2.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    points.forEachIndexed { i, p ->
        val cx = r.x(i); val cy = r.y(p.yFrac)
        if (i == n - 1) {
            drawCircle(Color.White, 5.5f, Offset(cx, cy))
            drawCircle(colors.line, 4f, Offset(cx, cy))
        } else {
            drawCircle(colors.line.copy(alpha = 0.4f), 2.5f, Offset(cx, cy))
        }
    }
}
