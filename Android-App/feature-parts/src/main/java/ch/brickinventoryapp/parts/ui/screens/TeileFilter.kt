package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.ui.components.AuswahlChip
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
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.withFont
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
    val wert: String,
    val text: String,
    val anzahl: Int,
    val farbe: Color? = null,
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
    farben: List<PartsFilterEntry>,
    kategorien: List<PartsFilterEntry>,
    colorSelected: String,
    categorySelected: String,
    onColor: (String) -> Unit,
    onCategory: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Nothing loaded, nothing to offer: a chip "Farbe" without content would be a
    // promise that tapping it does not keep.
    if (farben.isEmpty() && kategorien.isEmpty()) return

    var openColor by rememberSaveable { mutableStateOf(false) }
    var openCategory by rememberSaveable { mutableStateOf(false) }

    val alle = stringResource(R.string.parts_filter_all)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        if (farben.isNotEmpty()) {
            AuswahlChip(
                selected = colorSelected.isNotBlank(),
                onClick = { openColor = true },
                label = {
                    Text(farben.firstOrNull { it.wert == colorSelected }?.text
                        ?: stringResource(R.string.parts_filter_color),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(18.dp))) },
            )
        }
        if (kategorien.isNotEmpty()) {
            AuswahlChip(
                selected = categorySelected.isNotBlank(),
                onClick = { openCategory = true },
                label = {
                    Text(kategorien.firstOrNull { it.wert == categorySelected }?.text
                        ?: stringResource(R.string.parts_filter_category),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(18.dp))) },
            )
        }
    }

    if (openColor) {
        FilterSheet(
            titel = stringResource(R.string.parts_filter_color),
            eintraege = farben, gewaehlt = colorSelected, allText = alle,
            onWahl = { openColor = false; onColor(it) },
            onSchliessen = { openColor = false },
        )
    }
    if (openCategory) {
        FilterSheet(
            titel = stringResource(R.string.parts_filter_category),
            eintraege = kategorien, gewaehlt = categorySelected, allText = alle,
            onWahl = { openCategory = false; onCategory(it) },
            onSchliessen = { openCategory = false },
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
    titel: String,
    eintraege: List<PartsFilterEntry>,
    gewaehlt: String,
    allText: String,
    onWahl: (String) -> Unit,
    onSchliessen: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSchliessen) {
        Column(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.veryLarge)) {
            Text(titel, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                item {
                    FilterRow(allText, null, null, gewaehlt.isBlank()) { onWahl("") }
                }
                items(eintraege.size, key = { eintraege[it].wert }) { i ->
                    val e = eintraege[i]
                    FilterRow(e.text, e.anzahl, e.farbe, e.wert == gewaehlt) { onWahl(e.wert) }
                }
            }
        }
    }
}

/** One row of the selection sheet. */
@Composable
private fun FilterRow(
    text: String,
    anzahl: Int?,
    farbe: Color?,
    gewaehlt: Boolean,
    onKlick: () -> Unit,
) {
    Surface(
        onClick = onKlick,
        color = if (gewaehlt) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.mittel),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (farbe != null) {
                Box(Modifier.size(14.dp).clip(CircleShape).background(farbe))
                Spacer(Modifier.width(Abstaende.klein))
            }
            Text(text, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontWeight = if (gewaehlt) FontWeight.Bold else FontWeight.Normal)
            if (anzahl != null) {
                Text(fmtInt(anzahl),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
