package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.ui.components.BezeichnungUndWert
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.PathEffect
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.model.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.ui.model.PreisJeZustandAnsicht
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
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
import ch.brickinventoryapp.ui.components.Abschnittstitel
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.ui.util.fmtAmount
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtMoneyGanz

// Geteilte Detail-Composables, Preis-Chart und Kaufpreis-Erfassungszeile: Set-,
// Merkposten-, Teile- und Finanzansicht zeigen sie gleich, darum in core-ui.
// ── Shared composables ─────────────────────────────────────────────────────────

/**
 * Eine Angabe in der Kennzahlen-Fläche einer Detailseite: Bezeichnung, dann der Wert
 * fett („Jahr 2017“). Als Text in [KennzahlenReihe], nicht als erhabene Pille — die
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
    aussenAbstand: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    // Die Karte begrenzt die Breite, nicht jedes Element darin: Sonst endeten Werte, Felder
    // und Knöpfe auf dem Tablet an verschiedenen Stellen mitten in der Karte.
    AppKarte(Modifier.mittigBis(Lesebreite.formular)
        .then(if (aussenAbstand) Modifier.padding(horizontal = Abstaende.gross, vertical = 5.dp) else Modifier)) {
        Column(Modifier.padding(horizontal = Abstaende.gross, vertical = 14.dp)) {
            Abschnittstitel(title, Modifier.padding(bottom = 10.dp))
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
    // Preis zeigt jede Karte schon darüber, er stand sonst dreimal da.
    val allValues = lines.flatMap { it.points }.map { it.value }
    val tiefHoch = stringResource(R.string.price_chart_low_high,
        fmtMoney(allValues.min(), waehrung),
        fmtMoney(allValues.max(), waehrung))
    // Unter drei Messpunkten ist eine Linie keine Aussage: Zwei Punkte ohne Achse
    // lasen sich wie ein Trend. Dann Tief und Hoch und ein Satz, warum kein Diagramm.
    if (lines.maxOf { it.points.size } < MIN_PUNKTE_VERLAUF) {
        Text(tiefHoch, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
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
        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig),
    ) {
        Text(tiefHoch, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        lines.forEach { line ->
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                // Dasselbe Muster wie die Linie: gestrichelt oder durchgezogen, mit ihrer Endmarke.
                Canvas(Modifier.size(width = 28.dp, height = 10.dp)) {
                    val stil = linienStil(line.condition)
                    val mitte = Offset(size.width - 5.dp.toPx(), size.height / 2)
                    drawLine(colorFor(line.condition), Offset(0f, size.height / 2), mitte,
                        strokeWidth = PREISLINIE_BREITE.toPx(), pathEffect = strich(stil))
                    endmarke(colorFor(line.condition), stil, mitte, 3.5.dp.toPx())
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
            fmtAmount(z.tief), fmtAmount(z.hoch))
    }.joinToString("; ")
    val achse = PriceChartMath.yTicks(bounds).reversed()
    Row(Modifier.fillMaxWidth().height(mitSchriftHoehe(120.dp))) {
    // Die Wertachse: oben, Mitte, unten — an den Hilfslinien, auf ganze Beträge gerundet.
    Column(Modifier.fillMaxHeight().padding(end = Abstaende.klein),
        verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
        achse.forEach { v ->
            Text(fmtMoneyGanz(v, waehrung), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false)
        }
    }
    val randOben = with(androidx.compose.ui.platform.LocalDensity.current) {
        (MaterialTheme.typography.labelSmall.lineHeight.toPx() / 2)
    }
    Canvas(modifier = Modifier.weight(1f).fillMaxHeight().semantics { contentDescription = beschreibung }) {
        val w = size.width
        val h = size.height
        // So weit eingerückt wie die halbe Zeile der Achsenbeschriftung: Die Linien
        // stehen dann auf Höhe ihrer Zahlen.
        val topPad = randOben
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

            val stil = linienStil(line.condition)
            if (pts.size == 1) {
                endmarke(color, stil, pts.first(), 3.dp.toPx())
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
            drawPath(path, color, style = Stroke(width = PREISLINIE_BREITE.toPx(), pathEffect = strich(stil)))

            // Endpunkt: heller Ring, damit er auch dort sichtbar bleibt, wo
            // sich beide Linien treffen.
            endmarke(surfaceCol, stil, pts.last(), 4.dp.toPx())
            endmarke(color, stil, pts.last(), 2.5.dp.toPx())
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

/** Ab so vielen Messpunkten einer Reihe zeigt PriceChart eine Linie. */
const val MIN_PUNKTE_VERLAUF = 3

/** Breite der Preislinien: 3 px waren auf einem dichten Telefon kaum ein Strich. */
val PREISLINIE_BREITE = 2.dp

/**
 * Neu und Gebraucht unterscheiden sich auch in der Form, nicht nur im Farbton
 * (WCAG 1.4.1): Gebraucht gestrichelt und mit eckiger Endmarke.
 */
data class LinienStil(val gestrichelt: Boolean, val eckig: Boolean)

fun linienStil(zustand: String): LinienStil = if (zustand == "U") LinienStil(gestrichelt = true, eckig = true)
    else LinienStil(gestrichelt = false, eckig = false)

private fun DrawScope.strich(stil: LinienStil): PathEffect? =
    if (stil.gestrichelt) PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())) else null

private fun DrawScope.endmarke(farbe: Color, stil: LinienStil, mitte: Offset, radius: Float) {
    if (stil.eckig) drawRect(farbe, Offset(mitte.x - radius, mitte.y - radius), Size(radius * 2, radius * 2))
    else drawCircle(farbe, radius = radius, center = mitte)
}

/** Das Diagramm wächst mit der Schrift, damit die Achsenzahlen nicht ineinanderlaufen. */
@Composable
private fun mitSchriftHoehe(basis: Dp): Dp = mitSchrift(basis)

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

    val gross = grosseSchrift()
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
        Text(stringResource(R.string.detail_price_loading), Modifier.ansagen(),
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
fun WertKacheln(markt: String, kauf: String, pnl: Double?, modifier: Modifier = Modifier, pnlBetrag: String? = null) {
    val farben = MaterialTheme.colorScheme
    val akzent = LocalAkzentflaechen.current
    val status = LocalStatusFarben.current
    // Betrag und Prozent wie in den Finanzen („+CHF 112.50 · +16.1 %“), nicht nur Prozent.
    val pnlText = pnl?.let { listOfNotNull(pnlBetrag, fmtProzent(it)).joinToString(" · ") } ?: "—"
    val marktKachel: @Composable (Modifier) -> Unit = { m ->
        WertKachel(stringResource(R.string.detail_section_market), markt, akzent.markt, akzent.aufMarkt, m)
    }
    // Kaufpreis und G&V gleich gebaut (surface mit Rand), der Marktwert allein hervorgehoben:
    // Drei Kartenstile nebeneinander wirkten zufällig. Die Statusfarben halten 4,5:1 nur auf surface.
    val kaufKachel: @Composable (Modifier) -> Unit = { m ->
        WertKachel(stringResource(R.string.detail_purchase_price), kauf, akzent.kauf, akzent.aufKauf, m,
            rand = farben.outlineVariant)
    }
    val pnlKachel: @Composable (Modifier) -> Unit = { m ->
        // Nur die Zahl in Grün oder Rot: Die Beschriftung in Statusfarbe las sich wie ein Urteil.
        WertKachel(stringResource(R.string.detail_pnl_tile), pnlText, farben.surface,
            when { pnl == null -> farben.onSurfaceVariant; pnl < 0 -> status.fehler; else -> status.erfolg },
            m, rand = farben.outlineVariant, beschriftung = farben.onSurfaceVariant)
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
private fun WertKachel(label: String, wert: String, flaeche: Color, schrift: Color, modifier: Modifier = Modifier,
                       rand: Color? = null, beschriftung: Color = schrift) {
    Column(
        modifier
            .clip(Formen.leiste)
            .background(flaeche)
            .then(if (rand != null) Modifier.border(1.dp, rand, Formen.leiste) else Modifier)
            .padding(Abstaende.mittel)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(label, color = beschriftung, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(wert, color = schrift, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            maxLines = 1, softWrap = false)
    }
}
