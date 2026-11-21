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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Exactly one of two to four equal-ranked options (new | used,
 * falls below | rises above): Material intends the segmented button for this —
 * chips read like filters. With large text the segments stack, so
 * no word breaks and the shape stays the same.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SegmentChoice(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
    /** Off, when the choice currently has no effect; the caller says why next to it. */
    enabled: Boolean = true,
) {
    if (LocalDensity.current.fontScale >= LARGE_FONT_AB) {
        SegmentColumn(optionen, gewaehlt, onWahl, modifier, enabled)
        return
    }
    // Equally tall: if a label wraps to two lines, only its segment used to grow.
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
 * Material measures the label with the full inner width and places the checkmark
 * next to it; whatever overflows sticks out on both sides into the padding, at two lines past
 * the edge. The label therefore only gets enough width that the checkmark
 * stays [CHECKMARK_AIR] before the edge. Two lines instead of „Gebr…“ with large text.
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

/** Gap between checkmark and label in Material (SegmentedButton.kt, IconSpacing). */
private val CHECKMARK_GAP = 8.dp

/** This far the checkmark stays at minimum from the edge of the segment. */
internal val CHECKMARK_AIR = 2.dp

/**
 * A switch between views (sets | parts | minifigs) is always segments, never
 * chips that would look like filters. With large text they stack: scrolling
 * sideways, „Minifiguren“ sat outside the frame with nothing pointing to it.
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
                // Exactly as wide as the word: then an overflow in the text layout really
                // means truncated, not just „room next to the word“ (the segment always
                // reserves space for the checkmark next to it).
                Text(text, Modifier.width(IntrinsicSize.Max), maxLines = 1, softWrap = false)
            }
        }
    }
}

/**
 * Segments stacked, each the full width: rounded at top and bottom, straight
 * in between, edges overlapping. Material only knows the row; this way it stays the same
 * shape (border, checkmark, selection fill) and doesn't become a chip group.
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
                    // As wide as the word, like in the row: otherwise the text layout would report
                    // the whole segment width as overflow to the semantics, even though the word fits entirely.
                    Text(text, Modifier.width(IntrinsicSize.Max), style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

/** Segments whose lock state stays readable (lockedColors). */
@Composable
private fun segmentColors(): SegmentedButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return SegmentedButtonDefaults.colors(
        disabledActiveContainerColor = g.flaeche, disabledActiveContentColor = g.aufFlaeche,
        disabledActiveBorderColor = g.edge, disabledInactiveContentColor = g.schrift,
        disabledInactiveBorderColor = g.edge,
    )
}

/** The ends of a segment row: half-round at 48 dp height. */
private val COLUMN_ROUNDING = 24.dp

/**
 * A filter chip that selects exactly one value, read out as a radio button; the group
 * around it carries `selectableGroup()`. For filters only: a setting is a
 * [SegmentChoice] or a [SelectionField]. The text wraps instead of being truncated.
 */
@Composable
fun ChoiceChip(text: String, an: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val gesperrt = lockedColors(MaterialTheme.colorScheme)
    // Surface with selected/onClick instead of Modifier.selectable: this keeps the ripple within the chip shape.
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
 * Sorting: an icon with a menu, the same shape everywhere (gallery, wishlist,
 * catalog). Sorting narrows nothing and therefore doesn't sit between the
 * filter chips; a dot on the icon says it deviates from [vorgabe].
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
        // The dot is decoration; what it says is already in the button's name.
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
            // A heading says what the entries are about.
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
