package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.ui.components.LabelAndValue
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.centeredUntil
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.PathEffect
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.model.domain.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.domain.PricePerStateView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.LocalChartColors
import ch.brickinventoryapp.ui.util.fmtProzent
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.ui.util.fmtAmount
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtMoneyWhole

// Shared detail composables, price chart and purchase-price capture row: set,
// wishlist, parts and finance views all show them the same way, hence in core-ui.
// ── Shared composables ─────────────────────────────────────────────────────────

/**
 * A piece of information in a detail page's key-figures area: label, then the value in
 * bold („Jahr 2017“). As text in [MetricsSeries], not as a raised pill — that
 * looked tappable.
 */
@Composable
fun StatChipV2(label: String, value: String) {
    Text(
        androidx.compose.ui.text.buildAnnotatedString {
            append(label)
            append(' ')
            pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface))
            append(value)
            pop()
        },
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
fun SectionCard(
    title: String,
    /** Without one, if the list itself has a margin: otherwise the card stood narrower than its neighbors. */
    outerGap: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    // The card limits the width, not every element inside it: otherwise values, fields
    // and buttons on the tablet ended at different points in the middle of the card. In a
    // single column, the column is the limit; narrower, the card stood centered inside a margin.
    val breite = if (LocalSpaltenkarte.current) Modifier.fillMaxWidth() else Modifier.centeredUntil(Lesebreite.formular)
    AppKarte(breite
        .then(if (outerGap) Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.tiny) else Modifier)) {
        Column(Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel)) {
            SectionTitle(title, Modifier.padding(bottom = Abstaende.klein))
            content()
        }
    }
}

/** true in one column of the two-column tablet layout: [SectionCard] then takes its full width. */
val LocalSpaltenkarte = staticCompositionLocalOf { false }

@Composable
fun DetailRow2(label: String, value: String) {
    LabelAndValue(label, value, Modifier.padding(vertical = Abstaende.tiny))
}

/**
 * Price history with two lines (new and used) plus legend, computed in
 * ui/PriceChartMath.kt. Colors from the theme (LocalChartColors), the same as the
 * condition badges and --chart-new/--chart-used on the web.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PriceChart(chart: PreisDiagrammAnsicht, waehrung: Waehrung) {
    val lines  = remember(chart) { PriceChartMath.buildLines(chart) }
    val bounds = remember(lines) { PriceChartMath.bounds(lines) } ?: return
    if (lines.isEmpty()) return

    val chartColors = LocalChartColors.current
    val labelNew    = stringResource(R.string.condition_new)
    val labelUsed   = stringResource(R.string.condition_used)
    fun colorFor(cond: Zustand) = if (cond == Zustand.GEBRAUCHT) chartColors.used else chartColors.new
    fun labelFor(cond: Zustand) = if (cond == Zustand.GEBRAUCHT) labelUsed else labelNew

    // Low and high across BOTH series — the same scale. No „Current“: the current
    // price is already shown above by each card, it would otherwise stand there three times.
    val allValues = lines.flatMap { it.points }.map { it.value }
    val deepHigh = stringResource(R.string.price_chart_low_high,
        fmtMoney(allValues.min(), waehrung),
        fmtMoney(allValues.max(), waehrung))
    // Below three data points a line makes no statement: two points without an axis
    // read like a trend. Then low and high and a sentence why there's no chart.
    if (lines.maxOf { it.points.size } < MIN_POINTS_HISTORY) {
        Text(deepHigh, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.price_chart_too_few), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    // Legend on top next to low and high: between the fill and the time axis it read like
    // a label on the axis. Only conditions with a line — an entry without a line
    // would look like missing data.
    FlowRow(
        Modifier.fillMaxWidth().padding(bottom = Abstaende.klein),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.gross),
        verticalArrangement = Arrangement.spacedBy(Abstaende.tiny),
    ) {
        Text(deepHigh, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        lines.forEach { line ->
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
                // The same pattern as the line: dashed or solid, with its end mark.
                Canvas(Modifier.size(width = 28.dp, height = 10.dp)) {
                    val stil = linesStyle(line.condition)
                    val middle = Offset(size.width - 5.dp.toPx(), size.height / 2)
                    drawLine(colorFor(line.condition), Offset(0f, size.height / 2), middle,
                        strokeWidth = PRICE_LINE_WIDTH.toPx(), pathEffect = strich(stil))
                    endMarker(colorFor(line.condition), stil, middle, 3.5.dp.toPx())
                }
                Text(labelFor(line.condition),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }

    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val surfaceCol = MaterialTheme.colorScheme.surface
    // As in the value chart (PortfolioChart): without a description TalkBack skips the canvas.
    val beschreibung = PriceChartMath.zusammenfassung(lines).map { z ->
        stringResource(R.string.price_chart_summary, labelFor(z.zustand), z.von, z.bis,
            fmtAmount(z.anfang), fmtAmount(z.ende),
            fmtAmount(z.deep), fmtAmount(z.hoch))
    }.joinToString("; ")
    val axis = PriceChartMath.yTicks(bounds).reversed()
    Row(Modifier.fillMaxWidth().height(withFontHeight(120.dp))) {
    // The value axis: top, middle, bottom — at the guide lines, rounded to whole amounts.
    Column(Modifier.fillMaxHeight().padding(end = Abstaende.klein),
        verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
        axis.forEach { v ->
            Text(fmtMoneyWhole(v, waehrung), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false)
        }
    }
    val edgeTop = with(androidx.compose.ui.platform.LocalDensity.current) {
        (MaterialTheme.typography.labelSmall.lineHeight.toPx() / 2)
    }
    Canvas(modifier = Modifier.weight(1f).fillMaxHeight().semantics { contentDescription = beschreibung }) {
        val w = size.width
        val h = size.height
        // Indented as far as half the row of the axis label: the lines
        // then line up with the height of their numbers.
        val topPad = edgeTop
        val usableH = (h - topPad * 2).coerceAtLeast(1f)
        fun px(day: Long) = bounds.xFraction(day) * w
        fun py(v: Double) = topPad + bounds.yFraction(v) * usableH

        // Horizontal guide lines at the three axis values.
        PriceChartMath.yTicks(bounds).forEach { v ->
            val y = py(v)
            drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1f)
        }

        lines.forEach { line ->
            val color = colorFor(line.condition)
            val pts = line.points.map { Offset(px(it.day), py(it.value)) }

            val stil = linesStyle(line.condition)
            if (pts.size == 1) {
                endMarker(color, stil, pts.first(), 3.dp.toPx())
                return@forEach
            }

            // Fill under the line — only as a faint gradient, so two
            // fills on top of each other don't make each other unreadable.
            val fill = Path().apply {
                moveTo(pts.first().x, h)
                pts.forEach { lineTo(it.x, it.y) }
                lineTo(pts.last().x, h)
                close()
            }
            drawPath(fill, brush = Brush.verticalGradient(
                listOf(color.copy(alpha = 0.16f), color.copy(alpha = 0f))))

            val path = Path().apply {
                moveTo(pts.first().x, pts.first().y)
                pts.drop(1).forEach { lineTo(it.x, it.y) }
            }
            drawPath(path, color, style = Stroke(width = PRICE_LINE_WIDTH.toPx(), pathEffect = strich(stil)))

            // End point: a light ring, so it stays visible even where
            // the two lines meet.
            endMarker(surfaceCol, stil, pts.last(), 4.dp.toPx())
            endMarker(color, stil, pts.last(), 2.5.dp.toPx())
        }
    }
    }

    // Edge label of the time axis — the server's shared axis.
    PriceChartMath.axisRange(chart)?.let { (first, last) ->
        Row(
            Modifier.fillMaxWidth().padding(top = Abstaende.hairline),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(PriceChartMath.formatDay(first),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(PriceChartMath.formatDay(last),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** From this many data points in a series onward, PriceChart shows a line. */
const val MIN_POINTS_HISTORY = 3

/** Width of the price lines: 3 px were barely a stroke on a high-density phone. */
val PRICE_LINE_WIDTH = 2.dp

/**
 * New and used also differ in shape, not just in hue
 * (WCAG 1.4.1): used is dashed and has a square end mark.
 */
data class LinesStyle(val dashed: Boolean, val angular: Boolean)

fun linesStyle(zustand: Zustand): LinesStyle = if (zustand == Zustand.GEBRAUCHT) LinesStyle(dashed = true, angular = true)
    else LinesStyle(dashed = false, angular = false)

private fun DrawScope.strich(stil: LinesStyle): PathEffect? =
    if (stil.dashed) PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())) else null

private fun DrawScope.endMarker(farbe: Color, stil: LinesStyle, middle: Offset, radius: Float) {
    if (stil.angular) drawRect(farbe, Offset(middle.x - radius, middle.y - radius), Size(radius * 2, radius * 2))
    else drawCircle(farbe, radius = radius, center = middle)
}

/** The chart grows with the text size, so the axis numbers don't run into each other. */
@Composable
private fun withFontHeight(basis: Dp): Dp = withFont(basis)

/**
 * Market price and development per condition. A row only appears when the server
 * knows a capture for that condition; without a market or purchase price the
 * percentage stays empty, instead of computing against nothing.
 */
@Composable
fun MarketPriceByCondition(
    byCondition: PricePerStateView,
    currency: Waehrung,
) {
    val rows = byCondition.present()
    if (rows.isEmpty()) return
    val labelNew  = stringResource(R.string.condition_new)
    val labelUsed = stringResource(R.string.condition_used)
    val marketLabel = stringResource(R.string.detail_section_market)

    val gross = largeFont()
    Column(Modifier.fillMaxWidth()) {
        rows.forEach { (cond, data) ->
            val label = if (cond == Zustand.GEBRAUCHT) labelUsed else labelNew
            val bezeichnung: @Composable (Modifier) -> Unit = { m ->
                Text("$marketLabel ($label)", modifier = m,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val wert: @Composable () -> Unit = {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    // The price in text color instead of primary: in „noppe“ primary was red, a price
                    // looked like an error. Without a price, a word instead of a dash.
                    val markt = data.marketPrice
                    if (markt != null) {
                        Text(fmtMoney(markt, currency),
                            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1, softWrap = false)
                    } else {
                        Text(stringResource(R.string.detail_price_none_yet), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    data.pnlPct?.let { PnlBadge(it) }
                }
            }
            // Like LabelAndValue: stacked with large text.
            if (gross) Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.tiny)) {
                bezeichnung(Modifier)
                wert()
            } else Row(
                Modifier.fillMaxWidth().padding(vertical = Abstaende.tiny),
                verticalAlignment = Alignment.CenterVertically
            ) {
                bezeichnung(Modifier.weight(1f))
                wert()
            }
        }
    }
}

/**
 * „Preis wird geladen“ — spinner and text side by side, one implementation for
 * market price, price history and the manual-parts detail, so the next
 * change doesn't have to hunt through three spots.
 */
@Composable
fun PriceLoadsRow(modifier: Modifier = Modifier) {
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        Text(stringResource(R.string.detail_price_loading), Modifier.announce(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Percentage badge — green in the positive, error color in the negative. */
@Composable
fun PnlBadge(
    pct: Double,
    /** The same value in money; with it the badge says how much, not just how strongly. */
    betrag: String? = null,
) {
    val color = when {
        pct > 0 -> LocalStatusFarben.current.erfolg
        pct < 0 -> MaterialTheme.colorScheme.error
        else    -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(shape = Formen.chip, color = color.copy(alpha = 0.12f)) {
        Text(
            if (betrag != null) "$betrag · ${fmtProzent(pct)}" else fmtProzent(pct),
            color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp)
        )
    }
}

/** How the three value tiles stand: side by side, market value above the other two, or stacked. */
enum class TileArrangement { DREI, ONE_VIA_TWO, STACKED }

/**
 * The arrangement where the widest amount ([demand], including inner padding) fits
 * on one line in its tile. Decided by measuring rather than by font
 * size: „CHF 1’712.40“ already didn't fit a third at 100% on 360 dp.
 */
fun tileArrangement(breite: Dp, demand: Dp, abstand: Dp): TileArrangement = when {
    demand <= (breite - abstand * 2) / 3 -> TileArrangement.DREI
    demand <= (breite - abstand) / 2 -> TileArrangement.ONE_VIA_TWO
    else -> TileArrangement.STACKED
}

/**
 * Market value, purchase price and P&L at the top of every detail page, in every theme: the question
 * „what is it worth?“ is answered by the page first. An amount never wraps; if
 * the width doesn't suffice, first the market value moves above the other two, then everything
 * stacks. Tiles of a row are equally high.
 */
@Composable
fun WertKacheln(markt: String, kauf: String, pnl: Double?, modifier: Modifier = Modifier, pnlBetrag: String? = null) {
    val farben = MaterialTheme.colorScheme
    val accent = LocalAkzentflaechen.current
    val status = LocalStatusFarben.current
    // Amount and percentage as in finances („+CHF 112.50 · +16.1 %“), not just percentage.
    val pnlParts = pnl?.let { listOfNotNull(pnlBetrag, fmtProzent(it)) } ?: listOf("—")
    val pnlSingleLine = pnlParts.joinToString(" · ")
    val marketTile: @Composable (Modifier) -> Unit = { m ->
        ValueTile(stringResource(R.string.detail_section_market), markt, accent.markt, accent.onMarket, m)
    }
    // Purchase price and P&L built the same way (surface with border), the market value highlighted alone:
    // three card styles side by side looked arbitrary. The status colors only hold 4.5:1 on surface.
    val purchaseTile: @Composable (Modifier) -> Unit = { m ->
        ValueTile(stringResource(R.string.detail_purchase_price), kauf, accent.kauf, accent.onPurchase, m,
            edge = farben.outlineVariant)
    }
    val pnlTile: @Composable (Modifier, String) -> Unit = { m, pnlText ->
        // Only the number in green or red: the label in a status color read like a verdict.
        ValueTile(stringResource(R.string.detail_pnl_tile), pnlText, farben.surface,
            when { pnl == null -> farben.onSurfaceVariant; pnl < 0 -> status.fehler; else -> status.erfolg },
            m, edge = farben.outlineVariant, beschriftung = farben.onSurfaceVariant)
    }
    val meter = androidx.compose.ui.text.rememberTextMeasurer()
    val stil = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
    val dichte = androidx.compose.ui.platform.LocalDensity.current
    BoxWithConstraints(modifier.fillMaxWidth()) {
        fun breite(text: String) = with(dichte) {
            meter.measure(text, stil, softWrap = false, maxLines = 1).size.width.toDp()
        } + Abstaende.mittel * 2 + 2.dp
        val demand = listOf(markt, kauf, pnlSingleLine).maxOf { breite(it) }
        // If „amount · percent“ doesn't even fit the full width, both go stacked.
        val pnlText = if (breite(pnlSingleLine) > maxWidth) pnlParts.joinToString("\n") else pnlSingleLine
        val abstand = Abstaende.klein
        val equalHigh = Modifier.fillMaxWidth().height(IntrinsicSize.Min)
        when (tileArrangement(maxWidth, demand, abstand)) {
            TileArrangement.DREI -> Row(equalHigh, horizontalArrangement = Arrangement.spacedBy(abstand)) {
                marketTile(Modifier.weight(1f).fillMaxHeight())
                purchaseTile(Modifier.weight(1f).fillMaxHeight())
                pnlTile(Modifier.weight(1f).fillMaxHeight(), pnlText)
            }
            TileArrangement.ONE_VIA_TWO -> Column(verticalArrangement = Arrangement.spacedBy(abstand)) {
                marketTile(Modifier.fillMaxWidth())
                Row(equalHigh, horizontalArrangement = Arrangement.spacedBy(abstand)) {
                    purchaseTile(Modifier.weight(1f).fillMaxHeight())
                    pnlTile(Modifier.weight(1f).fillMaxHeight(), pnlText)
                }
            }
            TileArrangement.STACKED -> Column(verticalArrangement = Arrangement.spacedBy(abstand)) {
                marketTile(Modifier.fillMaxWidth())
                purchaseTile(Modifier.fillMaxWidth())
                pnlTile(Modifier.fillMaxWidth(), pnlText)
            }
        }
    }
}

/** A tile of the value row: label small, amount large, never wrapping within the amount. */
@Composable
private fun ValueTile(label: String, wert: String, flaeche: Color, schrift: Color, modifier: Modifier = Modifier,
                       edge: Color? = null, beschriftung: Color = schrift) {
    Column(
        modifier
            .clip(Formen.leiste)
            .background(flaeche)
            .then(if (edge != null) Modifier.border(1.dp, edge, Formen.leiste) else Modifier)
            .padding(Abstaende.mittel)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(label, color = beschriftung, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        // Line breaks only where the caller sets them: an amount never wraps on its own.
        Text(wert, color = schrift, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            maxLines = wert.count { it == '\n' } + 1, softWrap = false)
    }
}
