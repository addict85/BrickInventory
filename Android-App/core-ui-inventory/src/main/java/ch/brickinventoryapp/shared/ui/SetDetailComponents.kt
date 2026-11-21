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

// Geteilte Detail-Composables, Preis-Chart und Kaufpreis-Erfassungszeile: Set-,
// Merkposten-, Teile- und Finanzansicht zeigen sie gleich, darum in core-ui.
// ── Shared composables ─────────────────────────────────────────────────────────

/**
 * Eine Angabe in der Kennzahlen-Fläche einer Detailseite: Bezeichnung, dann der Wert
 * fett („Jahr 2017“). Als Text in [MetricsSeries], nicht als erhabene Pille — die
 * sah antippbar aus.
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
    /** Ohne, wenn die Liste selbst einen Rand hat: Die Karte stand sonst schmaler als ihre Nachbarn. */
    outerGap: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    // Die Karte begrenzt die Breite, nicht jedes Element darin: Sonst endeten Werte, Felder
    // und Knöpfe auf dem Tablet an verschiedenen Stellen mitten in der Karte. In einer
    // Spalte ist die Spalte die Grenze; schmaler stand die Karte mittig in einem Rand.
    val breite = if (LocalSpaltenkarte.current) Modifier.fillMaxWidth() else Modifier.centeredUntil(Lesebreite.formular)
    AppKarte(breite
        .then(if (outerGap) Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.tiny) else Modifier)) {
        Column(Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel)) {
            SectionTitle(title, Modifier.padding(bottom = Abstaende.klein))
            content()
        }
    }
}

/** true in einer Spalte des zweispaltigen Tablet-Layouts: [SectionCard] nimmt dann ihre volle Breite. */
val LocalSpaltenkarte = staticCompositionLocalOf { false }

@Composable
fun DetailRow2(label: String, value: String) {
    LabelAndValue(label, value, Modifier.padding(vertical = Abstaende.tiny))
}

/**
 * Preisverlauf mit zwei Linien (neu und gebraucht) samt Legende, gerechnet in
 * ui/PriceChartMath.kt. Farben aus dem Design (LocalChartColors), dieselben wie die
 * Zustands-Plaketten und --chart-new/--chart-used im Web.
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

    // Tief und Hoch über BEIDE Reihen — dieselbe Skala. Kein „Aktuell“: Den heutigen
    // Preis zeigt jede Karte schon darüber, er stand sonst dreimal da.
    val allValues = lines.flatMap { it.points }.map { it.value }
    val deepHigh = stringResource(R.string.price_chart_low_high,
        fmtMoney(allValues.min(), waehrung),
        fmtMoney(allValues.max(), waehrung))
    // Unter drei Messpunkten ist eine Linie keine Aussage: Zwei Punkte ohne Achse
    // lasen sich wie ein Trend. Dann Tief und Hoch und ein Satz, warum kein Diagramm.
    if (lines.maxOf { it.points.size } < MIN_POINTS_HISTORY) {
        Text(deepHigh, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.price_chart_too_few), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    // Legende oben neben Tief und Hoch: Zwischen Fläche und Zeitachse las sie sich wie
    // eine Beschriftung der Achse. Nur Zustände mit Linie — ein Eintrag ohne Linie
    // sähe nach fehlenden Daten aus.
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
                // Dasselbe Muster wie die Linie: gestrichelt oder durchgezogen, mit ihrer Endmarke.
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
    // Wie im Wertdiagramm (PortfolioChart): ohne Beschreibung überspringt TalkBack die Fläche.
    val beschreibung = PriceChartMath.zusammenfassung(lines).map { z ->
        stringResource(R.string.price_chart_summary, labelFor(z.zustand), z.von, z.bis,
            fmtAmount(z.anfang), fmtAmount(z.ende),
            fmtAmount(z.deep), fmtAmount(z.hoch))
    }.joinToString("; ")
    val axis = PriceChartMath.yTicks(bounds).reversed()
    Row(Modifier.fillMaxWidth().height(withFontHeight(120.dp))) {
    // Die Wertachse: oben, Mitte, unten — an den Hilfslinien, auf ganze Beträge gerundet.
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
        // So weit eingerückt wie die halbe Zeile der Achsenbeschriftung: Die Linien
        // stehen dann auf Höhe ihrer Zahlen.
        val topPad = edgeTop
        val usableH = (h - topPad * 2).coerceAtLeast(1f)
        fun px(day: Long) = bounds.xFraction(day) * w
        fun py(v: Double) = topPad + bounds.yFraction(v) * usableH

        // Waagerechte Hilfslinien an den drei Achsenwerten.
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

            // Fläche unter der Linie — nur als leiser Verlauf, damit sich zwei
            // Flächen übereinander nicht gegenseitig unlesbar machen.
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

            // Endpunkt: heller Ring, damit er auch dort sichtbar bleibt, wo
            // sich beide Linien treffen.
            endMarker(surfaceCol, stil, pts.last(), 4.dp.toPx())
            endMarker(color, stil, pts.last(), 2.5.dp.toPx())
        }
    }
    }

    // Randbeschriftung der Zeitachse — die gemeinsame Achse des Servers.
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

/** Ab so vielen Messpunkten einer Reihe zeigt PriceChart eine Linie. */
const val MIN_POINTS_HISTORY = 3

/** Breite der Preislinien: 3 px waren auf einem dichten Telefon kaum ein Strich. */
val PRICE_LINE_WIDTH = 2.dp

/**
 * Neu und Gebraucht unterscheiden sich auch in der Form, nicht nur im Farbton
 * (WCAG 1.4.1): Gebraucht gestrichelt und mit eckiger Endmarke.
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

/** Das Diagramm wächst mit der Schrift, damit die Achsenzahlen nicht ineinanderlaufen. */
@Composable
private fun withFontHeight(basis: Dp): Dp = withFont(basis)

/**
 * market price and development per condition. Eine Zeile erscheint nur, wenn der Server
 * für diesen Zustand eine Erfassung kennt; ohne Markt- oder Kaufpreis bleibt die
 * Prozentangabe leer, statt gegen nichts zu rechnen.
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
                    // Der Preis in Schriftfarbe statt primary: In „noppe“ war primary Rot, ein Preis
                    // sah aus wie ein Fehler. Ohne Preis ein Wort statt eines Strichs.
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
            // Wie LabelAndValue: bei grosser Schrift untereinander.
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
 * „Preis wird geladen“ — Kringel und Text nebeneinander, eine Fassung für
 * Marktpreis, Preisverlauf und das Detail manueller Teile, damit die nächste
 * Änderung nicht drei Stellen suchen muss.
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

/** Prozent-Plakette — grün im Plus, Fehlerfarbe im Minus. */
@Composable
fun PnlBadge(
    pct: Double,
    /** Derselbe Wert in Geld; mit ihm sagt die Plakette, wie viel, nicht nur wie stark. */
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

/** Wie die drei Wert-Kacheln stehen: nebeneinander, Marktwert über den zwei anderen oder untereinander. */
enum class TileArrangement { DREI, ONE_VIA_TWO, STACKED }

/**
 * Die Anordnung, in der der breiteste Betrag ([demand], samt Innenabstand) in
 * seiner Kachel einzeilig Platz hat. Gemessen statt an der Schriftgrösse
 * entschieden: „CHF 1’712.40“ passte schon bei 100 % auf 360 dp nicht in ein Drittel.
 */
fun tileArrangement(breite: Dp, demand: Dp, abstand: Dp): TileArrangement = when {
    demand <= (breite - abstand * 2) / 3 -> TileArrangement.DREI
    demand <= (breite - abstand) / 2 -> TileArrangement.ONE_VIA_TWO
    else -> TileArrangement.STACKED
}

/**
 * Marktwert, Kaufpreis und G&V oben auf jeder Detailseite, in jedem Design: Die Frage
 * „was ist es wert?“ beantwortet die Seite zuerst. Ein Betrag bricht nie um; reicht
 * die Breite nicht, rückt erst der Marktwert über die beiden anderen, dann alles
 * untereinander. tiles of a row are equally high.
 */
@Composable
fun WertKacheln(markt: String, kauf: String, pnl: Double?, modifier: Modifier = Modifier, pnlBetrag: String? = null) {
    val farben = MaterialTheme.colorScheme
    val accent = LocalAkzentflaechen.current
    val status = LocalStatusFarben.current
    // Betrag und Prozent wie in den Finanzen („+CHF 112.50 · +16.1 %“), nicht nur Prozent.
    val pnlParts = pnl?.let { listOfNotNull(pnlBetrag, fmtProzent(it)) } ?: listOf("—")
    val pnlSingleLine = pnlParts.joinToString(" · ")
    val marketTile: @Composable (Modifier) -> Unit = { m ->
        ValueTile(stringResource(R.string.detail_section_market), markt, accent.markt, accent.onMarket, m)
    }
    // Kaufpreis und G&V gleich gebaut (surface mit Rand), der Marktwert allein hervorgehoben:
    // Drei Kartenstile nebeneinander wirkten zufällig. Die Statusfarben halten 4,5:1 nur auf surface.
    val purchaseTile: @Composable (Modifier) -> Unit = { m ->
        ValueTile(stringResource(R.string.detail_purchase_price), kauf, accent.kauf, accent.onPurchase, m,
            edge = farben.outlineVariant)
    }
    val pnlTile: @Composable (Modifier, String) -> Unit = { m, pnlText ->
        // Nur die Zahl in Grün oder Rot: Die Beschriftung in Statusfarbe las sich wie ein Urteil.
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
        // Passt „Betrag · Prozent“ nicht einmal in die volle Breite, stehen beide untereinander.
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

/** Eine Kachel der Wertreihe: Bezeichnung klein, Betrag gross, ohne Umbruch im Betrag. */
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
        // Umbrüche nur dort, wo der Aufrufer sie setzt: ein Betrag bricht nie in sich.
        Text(wert, color = schrift, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            maxLines = wert.count { it == '\n' } + 1, softWrap = false)
    }
}
