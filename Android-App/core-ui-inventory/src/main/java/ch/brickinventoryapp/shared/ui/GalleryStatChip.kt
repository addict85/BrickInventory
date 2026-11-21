package ch.brickinventoryapp.shared.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.components.largeFont

/**
 * A key figure as text: number bold, label next to it. No surface of its own — the
 * bold pills looked like buttons but did nothing. Number and word from one
 * plural, otherwise it read „1 Exemplare“; read out together as one finding.
 */
@Composable
fun GalleryStatChip(anzahl: Int, plural: Int, detail: String? = null) {
    val zahl = fmtInt(anzahl)
    val text = pluralStringResource(plural, anzahl, zahl)
    // With large text, the breakdown goes on its own row: in the row it broke
    // right in the middle of the parenthesis („40 /einzeln“).
    val separator = if (largeFont()) "\n(" else "\u2002("
    // The breakdown small in the same row: as a second row below, the
    // key figure was wider than its value and left a gap before the next one.
    val klein = MaterialTheme.typography.labelSmall.fontSize
    val place = text.indexOf(zahl)
    Text(
        buildAnnotatedString {
            if (place < 0) append(text) else {
                append(text, 0, place)
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)) { append(zahl) }
                append(text, place + zahl.length, text.length)
            }
            if (detail != null) withStyle(SpanStyle(fontSize = klein)) {
                append(separator); append(detail.split(DIVIDER).joinToString(DIVIDER) { inseparable(it) }); append(')')
            }
        },
        Modifier.semantics(mergeDescendants = true) {},
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Number and word stay together („42 aus Sets“); the row may only wrap between the parts. */
private fun inseparable(text: String) = text.replace(' ', '\u00A0')

private const val DIVIDER = " · "

/**
 * The key figures above sets, parts, figures and in the detail — a calm surface
 * (surfaceContainerLow, without border or shadow), so none of them looks like a control.
 * They wrap, even at 200%: scrollable, with large text only part of it was
 * visible, and the arrow at the edge couldn't be tapped.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MetricsSeries(modifier: Modifier = Modifier, inhalt: @Composable () -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = Formen.leiste, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        FlowRow(
            Modifier.padding(horizontal = Abstaende.edge, vertical = Abstaende.klein),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.tiny),
        ) { inhalt() }
    }
}

/**
 * „144 aus Sets · 250 einzeln“ under the parts count, as in the web app — only when
 * there are individually captured parts; otherwise the row would just be the number above it again.
 */
@Composable
fun partsBreakdown(fromSets: Int?, einzeln: Int?): String? =
    if (fromSets != null && einzeln != null && einzeln > 0)
        stringResource(R.string.parts_breakdown, fmtInt(fromSets), fmtInt(einzeln))
    else null
