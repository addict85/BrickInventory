package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.util.fmtInt

/**
 * Eine Kennzahl als Text: Zahl fett, Bezeichnung daneben. Keine eigene Fläche — die
 * kräftigen Pillen sahen aus wie Knöpfe, taten aber nichts. Zusammengefasst
 * vorgelesen, damit „12 Sets“ eine Fundstelle ist und nicht zwei.
 */
@Composable
fun GalleryStatChip(value: String, label: String, detail: String? = null) {
    // Die Aufschlüsselung klein in derselben Zeile: Als zweite Zeile darunter war die
    // Kennzahl breiter als ihr Wert und liess eine Lücke vor der nächsten.
    val klein = MaterialTheme.typography.labelSmall.fontSize
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)) { append(value) }
            append(' ')
            append(label)
            if (detail != null) withStyle(SpanStyle(fontSize = klein)) { append("\u2002("); append(detail); append(')') }
        },
        Modifier.semantics(mergeDescendants = true) {},
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * Die Kennzahlen über Sets, Teilen, Figuren und im Detail — eine ruhige Fläche
 * (surfaceContainerLow, ohne Rand und Schatten), damit keine nach Bedienelement aussieht.
 * Bei grosser Schrift bricht das Detail um ([umbrechen]); die Listen wischen, damit das
 * erste Set nicht unter die Bildschirmhälfte rutscht — mit Verlauf und Pfeil am Rand,
 * solange dort noch etwas steht, weil sonst niemand das Wischen erahnt.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KennzahlenReihe(modifier: Modifier = Modifier, umbrechen: Boolean = false, inhalt: @Composable () -> Unit) {
    val flaeche = MaterialTheme.colorScheme.surfaceContainerLow
    Surface(modifier.fillMaxWidth(), shape = Formen.leiste, color = flaeche) {
        val innen = Modifier.padding(horizontal = Abstaende.rand, vertical = Abstaende.klein)
        if (ch.brickinventoryapp.ui.components.grosseSchrift() && !umbrechen) {
            val rolle = rememberScrollState()
            Box(Modifier.fillMaxWidth()) {
                Row(
                    innen.fillMaxWidth().randVerlauf(flaeche, links = rolle.canScrollBackward, rechts = rolle.canScrollForward)
                        .horizontalScroll(rolle),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.gross),
                ) { inhalt() }
                if (rolle.canScrollForward) Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null,
                    modifier = Modifier.align(Alignment.CenterEnd).testTag(KENNZAHLEN_MEHR).padding(end = Abstaende.winzig).size(mitSchrift(20.dp)),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else FlowRow(
            innen,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.winzig),
        ) { inhalt() }
    }
}

/** Testkennung des Pfeils, der auf weitere Kennzahlen rechts zeigt. */
const val KENNZAHLEN_MEHR = "kennzahlen-mehr"

/** Blendet den Inhalt an den Rändern aus, hinter denen noch etwas steht. */
private fun Modifier.randVerlauf(flaeche: Color, links: Boolean, rechts: Boolean): Modifier = drawWithContent {
    drawContent()
    val breite = VERLAUF_BREITE.toPx().coerceAtMost(size.width / 3)
    val leer = flaeche.copy(alpha = 0f)
    if (links) drawRect(Brush.horizontalGradient(listOf(flaeche, leer), startX = 0f, endX = breite),
        size = Size(breite, size.height))
    if (rechts) drawRect(Brush.horizontalGradient(listOf(leer, flaeche), startX = size.width - breite, endX = size.width),
        topLeft = Offset(size.width - breite, 0f), size = Size(breite, size.height))
}

private val VERLAUF_BREITE = 48.dp

/**
 * „144 aus Sets · 250 einzeln“ unter der Teilezahl, wie in der Webapp — nur wenn
 * es einzeln erfasste Teile gibt; sonst wäre die Zeile die Zahl darüber noch einmal.
 */
@Composable
fun teileAufschluesselung(ausSets: Int?, einzeln: Int?): String? =
    if (ausSets != null && einzeln != null && einzeln > 0)
        stringResource(R.string.parts_breakdown, fmtInt(ausSets), fmtInt(einzeln))
    else null
