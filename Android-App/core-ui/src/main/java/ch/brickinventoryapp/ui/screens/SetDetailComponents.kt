package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.ui.model.PreisJeZustandAnsicht
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.PriceChartMath
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalChartColors
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.Petrol
import ch.brickinventoryapp.ui.theme.SlateBlue
import coil3.ImageLoader
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.fmtProzent
import ch.brickinventoryapp.ui.theme.Abstaende

// Geteilte Detail-Composables, Preis-Chart und Kaufpreis-Erfassungszeile: Set-,
// Merkposten-, Teile- und Finanzansicht zeigen sie gleich, darum in core-ui.
// ── Shared composables ─────────────────────────────────────────────────────────

@Composable
fun StatChipV2(label: String, value: String) {
    Surface(
        shape = Formen.chip,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        tonalElevation = 1.dp
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = Abstaende.klein)
        ) {
            Text(
                value,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    AppKarte(Modifier.padding(horizontal = Abstaende.gross, vertical = 5.dp)) {
        Column(Modifier.padding(horizontal = Abstaende.gross, vertical = 14.dp)) {
            Text(
                title.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(bottom = 10.dp).semantics { heading() }
            )
            content()
        }
    }
}

@Composable
fun DetailRow2(label: String, value: String) {
    BezeichnungUndWert(label, value, Modifier.padding(vertical = 5.dp))
}

/**
 * Preisverlauf mit zwei Linien (neu und gebraucht) samt Legende, gerechnet in
 * ui/PriceChartMath.kt. Farben aus dem Design (LocalChartColors), dieselben wie die
 * Zustands-Plaketten und --chart-new/--chart-used im Web.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PriceChart(chart: PreisDiagrammAnsicht, waehrung: String) {
    val lines  = remember(chart) { PriceChartMath.buildLines(chart) }
    val bounds = remember(lines) { PriceChartMath.bounds(lines) } ?: return
    if (lines.isEmpty()) return

    val chartColors = LocalChartColors.current
    val labelNew    = stringResource(R.string.condition_new)
    val labelUsed   = stringResource(R.string.condition_used)
    fun colorFor(cond: String) = if (cond == "U") chartColors.used else chartColors.new
    fun labelFor(cond: String) = if (cond == "U") labelUsed else labelNew

    // Tief und Hoch über BEIDE Reihen — dieselbe Skala. Kein „Aktuell“: Den heutigen
    // Preis zeigt jede Karte schon darüber, er stand sonst dreimal da. Mit Währung,
    // weil die Achse dieses Diagramms keine Beträge trägt.
    val allValues = lines.flatMap { it.points }.map { it.value }
    FlowRow(
        Modifier.fillMaxWidth().padding(bottom = Abstaende.klein),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        PriceStatCell(stringResource(R.string.detail_price_low),
            ch.brickinventoryapp.util.fmtMoney(allValues.min(), waehrung))
        PriceStatCell(stringResource(R.string.detail_price_high),
            ch.brickinventoryapp.util.fmtMoney(allValues.max(), waehrung))
    }

    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val surfaceCol = MaterialTheme.colorScheme.surface
    // Wie im Wertdiagramm (PortfolioChart): ohne Beschreibung überspringt TalkBack die Fläche.
    val beschreibung = PriceChartMath.zusammenfassung(lines).map { z ->
        stringResource(R.string.price_chart_summary, labelFor(z.zustand), z.von, z.bis,
            ch.brickinventoryapp.util.fmtAmount(z.anfang), ch.brickinventoryapp.util.fmtAmount(z.ende),
            ch.brickinventoryapp.util.fmtAmount(z.tief), ch.brickinventoryapp.util.fmtAmount(z.hoch))
    }.joinToString("; ")
    Canvas(modifier = Modifier.fillMaxWidth().height(120.dp).semantics { contentDescription = beschreibung }) {
        val w = size.width
        val h = size.height
        val topPad = 4f
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

            if (pts.size == 1) {
                drawCircle(color, radius = 4f, center = pts.first())
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
            drawPath(path, color, style = Stroke(width = 3f))

            // Endpunkt: heller Ring, damit er auch dort sichtbar bleibt, wo
            // sich beide Linien treffen.
            drawCircle(surfaceCol, radius = 5.5f, center = pts.last())
            drawCircle(color, radius = 3.5f, center = pts.last())
        }
    }

    // ── Legende ───────────────────────────────────────────────────────────────
    // Nur die Zustände, die tatsächlich eine Linie haben: Ein Eintrag ohne
    // Linie im Diagramm liest sich wie fehlende Daten.
    Row(
        Modifier.fillMaxWidth().padding(top = Abstaende.klein),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.gross)
    ) {
        lines.forEach { line ->
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Canvas(Modifier.size(width = 16.dp, height = 3.dp)) {
                    drawLine(colorFor(line.condition),
                        Offset(0f, size.height / 2), Offset(size.width, size.height / 2),
                        strokeWidth = size.height)
                }
                Text(labelFor(line.condition),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }

    // Randbeschriftung der Zeitachse — die gemeinsame Achse des Servers.
    PriceChartMath.axisRange(chart)?.let { (first, last) ->
        Row(
            Modifier.fillMaxWidth().padding(top = Abstaende.haar),
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

/**
 * Marktpreis und Entwicklung je Zustand. Eine Zeile erscheint nur, wenn der Server
 * für diesen Zustand eine Erfassung kennt; ohne Markt- oder Kaufpreis bleibt die
 * Prozentangabe leer, statt gegen nichts zu rechnen.
 */
@Composable
fun MarketPriceByCondition(
    byCondition: PreisJeZustandAnsicht,
    currency: String,
) {
    val rows = byCondition.present()
    if (rows.isEmpty()) return
    val labelNew  = stringResource(R.string.condition_new)
    val labelUsed = stringResource(R.string.condition_used)
    val marketLabel = stringResource(R.string.detail_section_market)

    val gross = ch.brickinventoryapp.ui.components.grosseSchrift()
    Column(Modifier.fillMaxWidth()) {
        rows.forEach { (cond, data) ->
            val label = if (cond == "U") labelUsed else labelNew
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
                        Text(ch.brickinventoryapp.util.fmtMoney(markt, currency),
                            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1, softWrap = false)
                    } else {
                        Text(stringResource(R.string.detail_price_none_yet), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    data.pnlPct?.let { PnlBadge(it) }
                }
            }
            // Wie BezeichnungUndWert: bei grosser Schrift untereinander.
            if (gross) Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig)) {
                bezeichnung(Modifier)
                wert()
            } else Row(
                Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
                verticalAlignment = Alignment.CenterVertically
            ) {
                bezeichnung(Modifier.weight(1f))
                wert()
            }
        }
    }
}

/** Prozent-Plakette — grün im Plus, Fehlerfarbe im Minus. */
/**
 * „Preis wird geladen“ — Kringel und Text nebeneinander, eine Fassung für
 * Marktpreis, Preisverlauf und das Detail manueller Teile, damit die nächste
 * Änderung nicht drei Stellen suchen muss.
 */
@Composable
fun PreisLaedtZeile(modifier: Modifier = Modifier) {
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        Text(stringResource(R.string.detail_price_loading),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun PnlBadge(pct: Double) {
    val color = when {
        pct > 0 -> LocalStatusFarben.current.erfolg
        pct < 0 -> MaterialTheme.colorScheme.error
        else    -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(shape = Formen.chip, color = color.copy(alpha = 0.12f)) {
        Text(
            fmtProzent(pct),
            color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp)
        )
    }
}

@Composable
fun PriceStatCell(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, maxLines = 1, softWrap = false)
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Wie die drei Wert-Kacheln stehen: nebeneinander, Marktwert über den zwei anderen oder untereinander. */
enum class KachelAnordnung { DREI, EINS_UEBER_ZWEI, UNTEREINANDER }

/**
 * Die Anordnung, in der der breiteste Betrag ([bedarf], samt Innenabstand) in
 * seiner Kachel einzeilig Platz hat. Gemessen statt an der Schriftgrösse
 * entschieden: „CHF 1’712.40“ passte schon bei 100 % auf 360 dp nicht in ein Drittel.
 */
fun kachelAnordnung(breite: Dp, bedarf: Dp, abstand: Dp): KachelAnordnung = when {
    bedarf <= (breite - abstand * 2) / 3 -> KachelAnordnung.DREI
    bedarf <= (breite - abstand) / 2 -> KachelAnordnung.EINS_UEBER_ZWEI
    else -> KachelAnordnung.UNTEREINANDER
}

/**
 * Marktwert, Kaufpreis und G&V oben auf jeder Detailseite, in jedem Design: Die Frage
 * „was ist es wert?“ beantwortet die Seite zuerst. Ein Betrag bricht nie um; reicht
 * die Breite nicht, rückt erst der Marktwert über die beiden anderen, dann alles
 * untereinander. Kacheln einer Reihe sind gleich hoch.
 */
@Composable
fun WertKacheln(markt: String, kauf: String, pnl: Double?, modifier: Modifier = Modifier) {
    val farben = MaterialTheme.colorScheme
    val akzent = ch.brickinventoryapp.ui.theme.LocalAkzentflaechen.current
    val status = LocalStatusFarben.current
    val pnlText = pnl?.let { fmtProzent(it) } ?: "—"
    val marktKachel: @Composable (Modifier) -> Unit = { m ->
        WertKachel(stringResource(R.string.detail_section_market), markt, akzent.markt, akzent.aufMarkt, m)
    }
    val kaufKachel: @Composable (Modifier) -> Unit = { m ->
        WertKachel(stringResource(R.string.detail_purchase_price), kauf, akzent.kauf, akzent.aufKauf, m)
    }
    // Die Statusfarben halten 4,5:1 nur auf surface — deshalb diese Fläche mit Rand.
    val pnlKachel: @Composable (Modifier) -> Unit = { m ->
        WertKachel(stringResource(R.string.detail_pnl_tile), pnlText, farben.surface,
            when { pnl == null -> farben.onSurfaceVariant; pnl < 0 -> status.fehler; else -> status.erfolg },
            m, rand = farben.outline)
    }
    val messer = androidx.compose.ui.text.rememberTextMeasurer()
    val stil = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
    val dichte = androidx.compose.ui.platform.LocalDensity.current
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val breitester = listOf(markt, kauf, pnlText).maxOf {
            messer.measure(it, stil, softWrap = false, maxLines = 1).size.width
        }
        val bedarf = with(dichte) { breitester.toDp() } + Abstaende.mittel * 2 + 2.dp
        val abstand = Abstaende.klein
        val gleichHoch = Modifier.fillMaxWidth().height(IntrinsicSize.Min)
        when (kachelAnordnung(maxWidth, bedarf, abstand)) {
            KachelAnordnung.DREI -> Row(gleichHoch, horizontalArrangement = Arrangement.spacedBy(abstand)) {
                marktKachel(Modifier.weight(1f).fillMaxHeight())
                kaufKachel(Modifier.weight(1f).fillMaxHeight())
                pnlKachel(Modifier.weight(1f).fillMaxHeight())
            }
            KachelAnordnung.EINS_UEBER_ZWEI -> Column(verticalArrangement = Arrangement.spacedBy(abstand)) {
                marktKachel(Modifier.fillMaxWidth())
                Row(gleichHoch, horizontalArrangement = Arrangement.spacedBy(abstand)) {
                    kaufKachel(Modifier.weight(1f).fillMaxHeight())
                    pnlKachel(Modifier.weight(1f).fillMaxHeight())
                }
            }
            KachelAnordnung.UNTEREINANDER -> Column(verticalArrangement = Arrangement.spacedBy(abstand)) {
                marktKachel(Modifier.fillMaxWidth())
                kaufKachel(Modifier.fillMaxWidth())
                pnlKachel(Modifier.fillMaxWidth())
            }
        }
    }
}

/** Eine Kachel der Wertreihe: Bezeichnung klein, Betrag gross und immer in einer Zeile. */
@Composable
private fun WertKachel(label: String, wert: String, flaeche: Color, schrift: Color, modifier: Modifier = Modifier, rand: Color? = null) {
    Column(
        modifier
            .clip(Formen.leiste)
            .background(flaeche)
            .then(if (rand != null) Modifier.border(1.dp, rand, Formen.leiste) else Modifier)
            .padding(Abstaende.mittel)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(label, color = schrift, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(wert, color = schrift, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            maxLines = 1, softWrap = false)
    }
}
