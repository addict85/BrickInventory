package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.SelectionChip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtInt

/**
 * A filter entry of the parts list: value, label, count, color dot. A
 * shared shape for color and category: the lists come from different
 * addresses with different field names, but look the same and are handled
 * the same — two versions had drifted apart.
 *
 * @param wert   What travels along as `color=` or `category=`. "" means "all".
 * @param anzahl Distinct parts — the same number the web app shows.
 * @param farbe  Color dot, only for the color list.
 */
internal data class PartsFilterEntry(
    val value: String,
    val text: String,
    val count: Int,
    val color: Color? = null,
)

/**
 * Color and category as two expandable filters — like the web app's two
 * filter lists (teile.js, `loadPartsFilters` → `#color-filter` and
 * `#cat-filter`), each with the count next to it. `getParts` passes `color` and
 * `category` to the server.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PartsFilterRow(
    colors: List<PartsFilterEntry>,
    categories: List<PartsFilterEntry>,
    colorSelected: String,
    categorySelected: String,
    onColor: (String) -> Unit,
    onCategory: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Nothing loaded, nothing to offer: a chip "Farbe" without content would be a
    // promise that tapping it does not keep.
    if (colors.isEmpty() && categories.isEmpty()) return

    var openColor by rememberSaveable { mutableStateOf(false) }
    var openCategory by rememberSaveable { mutableStateOf(false) }

    val all = stringResource(R.string.parts_filter_all)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        if (colors.isNotEmpty()) {
            SelectionChip(
                selected = colorSelected.isNotBlank(),
                onClick = { openColor = true },
                label = {
                    Text(colors.firstOrNull { it.value == colorSelected }?.text
                        ?: stringResource(R.string.parts_filter_color),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(18.dp))) },
            )
        }
        if (categories.isNotEmpty()) {
            SelectionChip(
                selected = categorySelected.isNotBlank(),
                onClick = { openCategory = true },
                label = {
                    Text(categories.firstOrNull { it.value == categorySelected }?.text
                        ?: stringResource(R.string.parts_filter_category),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(18.dp))) },
            )
        }
    }

    if (openColor) {
        FilterSheet(
            title = stringResource(R.string.parts_filter_color),
            items = colors, chosen = colorSelected, allText = all,
            onChoice = { openColor = false; onColor(it) },
            onClose = { openColor = false },
        )
    }
    if (openCategory) {
        FilterSheet(
            title = stringResource(R.string.parts_filter_category),
            items = categories, chosen = categorySelected, allText = all,
            onChoice = { openCategory = false; onCategory(it) },
            onClose = { openCategory = false },
        )
    }
}

/**
 * The selection sheet — one version for both lists.
 *
 * "Alle" sits at the top and is always there; without this entry, a
 * set filter could only be cleared via the back path.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterSheet(
    title: String,
    items: List<PartsFilterEntry>,
    chosen: String,
    allText: String,
    onChoice: (String) -> Unit,
    onClose: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(Modifier.padding(horizontal = Spacing.large).padding(bottom = Spacing.veryLarge)) {
            Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                item {
                    FilterRow(allText, null, null, chosen.isBlank()) { onChoice("") }
                }
                items(items.size, key = { items[it].value }) { i ->
                    val e = items[i]
                    FilterRow(e.text, e.count, e.color, e.value == chosen) { onChoice(e.value) }
                }
            }
        }
    }
}

/** One row of the selection sheet. */
@Composable
private fun FilterRow(
    text: String,
    count: Int?,
    color: Color?,
    chosen: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = if (chosen) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = Spacing.small, vertical = Spacing.medium),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (color != null) {
                Box(Modifier.size(14.dp).clip(CircleShape).background(color))
                Spacer(Modifier.width(Spacing.small))
            }
            Text(text, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontWeight = if (chosen) FontWeight.Bold else FontWeight.Normal)
            if (count != null) {
                Text(fmtInt(count),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
