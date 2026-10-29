package ch.brickinventoryapp.ui.screens

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
import androidx.compose.foundation.clickable
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
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
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.model.PriceChartData
import ch.brickinventoryapp.data.model.PriceByCondition
import ch.brickinventoryapp.ui.PriceChartMath
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalChartColors
import ch.brickinventoryapp.ui.theme.BrickStatTile
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.Petrol
import ch.brickinventoryapp.ui.theme.SlateBlue
import coil3.compose.AsyncImage
import coil3.ImageLoader
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.fmtProzent
import ch.brickinventoryapp.ui.theme.Abstaende

// Aus SetDetailScreen.kt ausgelagert (Lesbarkeit): geteilte Detail-Composables,
// Preis-Chart und Kaufpreis-Erfassungszeile. private→internal, damit der
// Hauptscreen (gleiches Modul/Package) sie weiter nutzen kann.
// ── Shared composables ─────────────────────────────────────────────────────────

@Composable
internal fun StatChipV2(label: String, value: String) {
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
internal fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
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
internal fun DetailRow2(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.End
        )
    }
}

/**
 * Preisverlauf mit zwei Linien (neu und gebraucht) samt Legende. Gezeichnet aus
 * `chart` (history_new/history_used mit gemeinsamer x-Achse), gerechnet in
 * ui/PriceChartMath.kt — dort stehen die Gründe für die x-Achse nach Datum und das
 * Überspringen der aufgefüllten Nullen.
 *
 * Farben aus dem Design (LocalChartColors), dieselben wie die Zustands-Plaketten
 * und --chart-new/--chart-used in der Webapp. Ohne `currency`-Parameter: Die drei
 * Kennzahlen zeigen reine Beträge, und ein durchgereichter, ungenutzter Parameter
 * verdeckt, dass er fehlt (siehe imageLoader in SetDetailScreen).
 */
@Composable
fun PriceChart(chart: PriceChartData) {
    val lines  = remember(chart) { PriceChartMath.buildLines(chart) }
    val bounds = remember(lines) { PriceChartMath.bounds(lines) } ?: return
    if (lines.isEmpty()) return

    val chartColors = LocalChartColors.current
    val labelNew    = stringResource(R.string.condition_new)
    val labelUsed   = stringResource(R.string.condition_used)
    fun colorFor(cond: String) = if (cond == "U") chartColors.used else chartColors.new
    fun labelFor(cond: String) = if (cond == "U") labelUsed else labelNew

    // Kennzahlen über BEIDE Reihen — dieselbe Skala, dieselben Eckwerte.
    // "Aktuell" ist der jüngste Punkt über beide Linien hinweg; bei einem Set,
    // das nur gebraucht erfasst ist, steht dort also der Gebrauchtpreis.
    val allPoints = lines.flatMap { it.points }
    val allValues = allPoints.map { it.value }
    val latest    = allPoints.maxByOrNull { it.day }?.value ?: return
    Row(
        Modifier.fillMaxWidth().padding(bottom = Abstaende.klein),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        // Ohne Währung: Die drei Kennzahlen stehen als Gruppe unter dem
        // Diagramm, dessen Beschriftung die Währung bereits nennt.
        PriceStatCell(stringResource(R.string.detail_price_low),
            ch.brickinventoryapp.util.fmtAmount(allValues.min()))
        PriceStatCell(stringResource(R.string.detail_price_current),
            ch.brickinventoryapp.util.fmtAmount(latest))
        PriceStatCell(stringResource(R.string.detail_price_high),
            ch.brickinventoryapp.util.fmtAmount(allValues.max()))
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
 * Marktpreis und Entwicklung JE ZUSTAND.
 *
 * Eine Zeile erscheint nur, wenn für diesen Zustand auch eine Erfassung
 * existiert — das entscheidet der Server (by_condition, utils/priceHistory.ts)
 * und liefert für die anderen gar keinen Eintrag. Damit taucht eine Zeile von
 * selbst auf, sobald ein Kaufpreis in diesem Zustand erfasst wird.
 *
 * Ohne Marktpreis oder ohne Kaufpreis bleibt die Prozentangabe leer: eine Zahl
 * gegen nichts gerechnet wäre bedeutungslos.
 */
@Composable
fun MarketPriceByCondition(
    byCondition: PriceByCondition,
    currency: String,
) {
    val rows = byCondition.present()
    if (rows.isEmpty()) return
    val labelNew  = stringResource(R.string.condition_new)
    val labelUsed = stringResource(R.string.condition_used)
    val marketLabel = stringResource(R.string.detail_section_market)

    Column(Modifier.fillMaxWidth()) {
        rows.forEach { (cond, data) ->
            val label = if (cond == "U") labelUsed else labelNew
            Row(
                Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("$marketLabel ($label)",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(
                        data.marketPrice?.let {
                            ch.brickinventoryapp.util.fmtMoney(it, currency)
                        } ?: "—",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (data.marketPrice != null) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    data.pnlPct?.let { PnlBadge(it) }
                }
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
internal fun PriceStatCell(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
