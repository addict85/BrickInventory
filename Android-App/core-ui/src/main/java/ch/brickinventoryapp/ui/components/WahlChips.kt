package ch.brickinventoryapp.ui.components

import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonColors
import androidx.compose.material3.SegmentedButtonDefaults
import ch.brickinventoryapp.ui.theme.lockedColors
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.heading
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Genau eine von zwei bis vier gleichrangigen Möglichkeiten (Neu | Gebraucht,
 * Fällt unter | Steigt über): Material sieht dafür die Segmentschaltfläche vor —
 * Chips lesen sich wie Filter. Bei grosser Schrift stehen die Segmente untereinander,
 * damit kein Wort bricht und die Bauform dieselbe bleibt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SegmentChoice(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
    /** Aus, wenn die Wahl gerade nichts bewirkt; der Aufrufer sagt daneben, warum. */
    enabled: Boolean = true,
) {
    if (LocalDensity.current.fontScale >= LARGE_FONT_AB) {
        SegmentColumn(optionen, gewaehlt, onWahl, modifier, enabled)
        return
    }
    // Gleich hoch: Bricht eine Beschriftung in zwei Zeilen, wuchs sonst nur ihr Segment.
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        optionen.forEachIndexed { i, (wert, text) ->
            SegmentedButton(
                selected = wert == gewaehlt,
                onClick = { onWahl(wert) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = optionen.size),
                modifier = Modifier.fillMaxHeight(),
                enabled = enabled,
                colors = segmentColors(),
            ) { SegmentLabel(text) }
        }
    }
}

/**
 * Material misst die Beschriftung mit der vollen Innenbreite und setzt das Häkchen
 * daneben; was übersteht, ragt beidseits in den Innenabstand, bei zwei Zeilen bis über
 * den Rand. Die Beschriftung bekommt deshalb nur so viel Breite, dass das Häkchen
 * [CHECKMARK_AIR] vor dem Rand bleibt. Zwei Zeilen statt „Gebr…“ bei grosser Schrift.
 */
@Composable
private fun SegmentLabel(text: String) {
    val edge = SegmentedButtonDefaults.ContentPadding.calculateStartPadding(LocalLayoutDirection.current)
    val deduction = with(LocalDensity.current) {
        (SegmentedButtonDefaults.IconSize + CHECKMARK_GAP - (edge - CHECKMARK_AIR) * 2).roundToPx().coerceAtLeast(0)
    }
    Layout({
        Text(text, maxLines = 2, overflow = TextOverflow.Ellipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }) { teile, c ->
        val breite = if (c.hasBoundedWidth) (c.maxWidth - deduction).coerceAtLeast(0) else c.maxWidth
        val zeilen = teile.single().measure(c.copy(minWidth = 0, maxWidth = breite))
        layout(zeilen.width, zeilen.height) { zeilen.place(0, 0) }
    }
}

/** Abstand zwischen Häkchen und Beschriftung in Material (SegmentedButton.kt, IconSpacing). */
private val CHECKMARK_GAP = 8.dp

/** So weit bleibt das Häkchen mindestens vom Rand des Segments. */
internal val CHECKMARK_AIR = 2.dp

/**
 * Ein Wechsel zwischen Ansichten (Sets | Teile | Minifiguren) sind immer Segmente, nie
 * Chips, die wie Filter aussähen. Bei grosser Schrift stehen sie untereinander: Seitlich
 * rollend lag „Minifiguren“ ausserhalb des Bilds, ohne dass etwas darauf hinwies.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> ViewToggle(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (LocalDensity.current.fontScale >= LARGE_FONT_AB) {
        SegmentColumn(optionen, gewaehlt, onWahl, modifier)
        return
    }
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        optionen.forEachIndexed { i, (wert, text) ->
            SegmentedButton(
                selected = wert == gewaehlt,
                onClick = { onWahl(wert) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = optionen.size),
            ) {
                // Genau so breit wie das Wort: Dann heisst ein Überlauf im Textlayout wirklich
                // abgeschnitten, nicht bloss „Platz neben dem Wort“ (das Segment reserviert
                // daneben immer Raum fürs Häkchen).
                Text(text, Modifier.width(IntrinsicSize.Max), maxLines = 1, softWrap = false)
            }
        }
    }
}

/**
 * Segmente untereinander, je über die volle Breite: oben und unten gerundet, dazwischen
 * gerade, die Ränder übereinander. Material kennt nur die Zeile; so bleibt es dieselbe
 * Bauform (Rand, Häkchen, Fläche der Wahl) und wird nicht zur Chipgruppe.
 */
@Composable
private fun <T> SegmentColumn(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val farben = MaterialTheme.colorScheme
    val gesperrt = lockedColors(farben)
    Column(modifier.fillMaxWidth().selectableGroup()) {
        optionen.forEachIndexed { i, (wert, text) ->
            val an = wert == gewaehlt
            val form = RoundedCornerShape(
                topStart = if (i == 0) COLUMN_ROUNDING else 0.dp, topEnd = if (i == 0) COLUMN_ROUNDING else 0.dp,
                bottomStart = if (i == optionen.lastIndex) COLUMN_ROUNDING else 0.dp,
                bottomEnd = if (i == optionen.lastIndex) COLUMN_ROUNDING else 0.dp,
            )
            Surface(
                selected = an,
                onClick = { onWahl(wert) },
                enabled = enabled,
                shape = form,
                color = if (!enabled && an) gesperrt.flaeche else if (an) farben.secondaryContainer else farben.surface,
                contentColor = when {
                    !enabled -> if (an) gesperrt.aufFlaeche else gesperrt.schrift
                    an -> farben.onSecondaryContainer
                    else -> farben.onSurface
                },
                border = BorderStroke(1.dp, if (enabled) farben.outline else gesperrt.edge),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).offset(y = -(i.dp))
                    .focusFrame(form).semantics { role = Role.RadioButton },
            ) {
                Row(Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein),
                    horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    if (an) {
                        Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
                        Spacer(Modifier.width(Abstaende.klein))
                    }
                    // So breit wie das Wort, wie in der Zeile: Sonst meldet das Textlayout der
                    // Semantik die ganze Segmentbreite als Überlauf, obwohl das Wort ganz dasteht.
                    Text(text, Modifier.width(IntrinsicSize.Max), style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

/** Segmente, deren Sperre lesbar bleibt (lockedColors). */
@Composable
private fun segmentColors(): SegmentedButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return SegmentedButtonDefaults.colors(
        disabledActiveContainerColor = g.flaeche, disabledActiveContentColor = g.aufFlaeche,
        disabledActiveBorderColor = g.edge, disabledInactiveContentColor = g.schrift,
        disabledInactiveBorderColor = g.edge,
    )
}

/** Wie die Enden einer Segmentzeile: halbrund bei 48 dp Höhe. */
private val COLUMN_ROUNDING = 24.dp

/**
 * Ein Filter-Chip, der genau einen Wert wählt, vorgelesen als Optionsfeld; die Gruppe
 * drumherum trägt `selectableGroup()`. Nur für Filter: Eine Einstellung ist eine
 * [SegmentChoice] oder ein [SelectionField]. Der Text bricht um statt abgeschnitten zu werden.
 */
@Composable
fun ChoiceChip(text: String, an: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val gesperrt = lockedColors(MaterialTheme.colorScheme)
    // Surface mit selected/onClick statt Modifier.selectable: so bleibt die Welle in der Chipform.
    Surface(
        selected = an,
        onClick = onClick,
        enabled = enabled,
        shape = Formen.chip,
        color = if (an) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
        contentColor = when {
            !enabled -> gesperrt.schrift
            an -> MaterialTheme.colorScheme.onSecondaryContainer
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        },
        border = BorderStroke(if (an) 2.dp else 1.dp, when {
            !enabled -> gesperrt.edge
            an -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.outline
        }),
        modifier = modifier.heightIn(min = 48.dp).focusFrame(Formen.chip)
            .semantics { role = Role.RadioButton },
    ) {
        Row(Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (an) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
            Text(text, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/**
 * Die Sortierung: ein Symbol mit Menü, überall dieselbe Bauform (Galerie, Merkliste,
 * Katalog). Sortieren schränkt nichts ein und steht deshalb nicht zwischen den
 * Filter-Chips; ein Punkt am Symbol sagt, dass von [vorgabe] abgewichen wird.
 */
@Composable
fun <T> SortierMenu(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
    vorgabe: T? = null,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    val aktuell = optionen.firstOrNull { it.first == gewaehlt }?.second ?: ""
    Box(modifier) {
        // Der Punkt ist Zierde; was er sagt, steht schon im Namen des Knopfs.
        BadgedBox(badge = { if (vorgabe != null && gewaehlt != vorgabe) Badge(Modifier.clearAndSetSemantics {}) }) {
            MitTooltip(stringResource(R.string.sort_menu_cd, aktuell)) {
                OutlinedIconButton(
                    onClick = { offen = true },
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Sort, stringResource(R.string.sort_menu_cd, aktuell))
                }
            }
        }
        DropdownMenu(offen, { offen = false }) {
            // Eine Überschrift sagt, wonach die Einträge fragen.
            Text(stringResource(R.string.filter_section_sort), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein).semantics { heading() })
            optionen.forEach { (wert, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    onClick = { offen = false; if (wert != gewaehlt) onWahl(wert) },
                    leadingIcon = {
                        if (wert == gewaehlt) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
                        else Spacer(Modifier.size(18.dp))
                    },
                    modifier = Modifier.semantics { selected = wert == gewaehlt },
                )
            }
        }
    }
}
