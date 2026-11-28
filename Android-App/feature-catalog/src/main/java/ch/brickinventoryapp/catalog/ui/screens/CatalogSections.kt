package ch.brickinventoryapp.catalog.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.*
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.SearchField
import ch.brickinventoryapp.ui.components.SelectionChip
import ch.brickinventoryapp.ui.components.SortMenu
import ch.brickinventoryapp.ui.components.searchFieldWidth
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Spacing

// The catalog page's sections: search field, filter row (theme, year, sort order)
// and hit list next to the grid. Unlike SetDetail and Finance,
// ordinary @Composable functions, because they sit in a `Column`, not in
// a LazyColumn.

/**
 * Filter row: theme and year; sorting goes through the menu next to search. Deliberate
 * exception from the collection's filter sheet: the catalog has only these two filters, both with
 * a long, searchable list, and the chip already shows the chosen value itself.
 */
@Composable
internal fun CatalogFilterRow(state: CatalogUiState, selectedThemeName: String?, showThemeSheet: MutableState<Boolean>, showYearSheet: MutableState<Boolean>) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.padding(bottom = 6.dp)
    ) {
        item {
            SelectionChip(
                selected = state.themeId != null,
                onClick = { showThemeSheet.value = true },
                label = {
                    Text(selectedThemeName ?: stringResource(R.string.catalog_filter_theme),
                        style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(16.dp))) },
                modifier = Modifier.widthIn(max = 180.dp),
            )
        }
        item {
            SelectionChip(
                selected = state.year != null,
                onClick = { showYearSheet.value = true },
                label = { Text(state.year?.toString() ?: stringResource(R.string.catalog_filter_year), style = MaterialTheme.typography.labelMedium) },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(16.dp))) },
            )
        }
    }
}

/** The search field above the list, sort order next to it. */
@Composable
internal fun CatalogSearchField(state: CatalogUiState, onQueryChange: (String) -> Unit, onSortChange: (CatalogSort) -> Unit) {
    // Search field — the same building block as in gallery, parts and minifigures
    // (TableRow.kt), so the clear button is named the same everywhere.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        SearchField(
            value = state.query,
            onValue = onQueryChange,
            placeholder = stringResource(R.string.catalog_search_placeholder),
            modifier = Modifier.searchFieldWidth(this),
        )
        SortMenu(
            options = CatalogSort.entries.map { it to it.label() },
            chosen = state.sort,
            onChoice = onSortChange,
            modifier = Modifier.padding(end = Spacing.edge),
            default = CatalogSort.DEFAULT,
        )
    }
}

/** Selection sheet for the year. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CatalogYearSheet(state: CatalogUiState, showYearSheet: MutableState<Boolean>, onYearChange: (Int?) -> Unit) {
    if (showYearSheet.value) {
        ModalBottomSheet(onDismissRequest = { showYearSheet.value = false }) {
            Column(Modifier.padding(horizontal = Spacing.large).padding(bottom = Spacing.veryLarge)) {
                Text(stringResource(R.string.catalog_filter_year), Modifier.semantics { heading() },
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(Spacing.small))
                val years = remember(state.yearMin, state.yearMax) {
                    val max = state.yearMax ?: 0; val min = state.yearMin ?: 0
                    if (max >= min && max > 0) (max downTo min).toList() else emptyList()
                }
                LazyColumn(Modifier.heightIn(max = 420.dp).selectableGroup()) {
                    item {
                        ThemeRow(stringResource(R.string.catalog_all_years), state.year == null) {
                            showYearSheet.value = false; onYearChange(null)
                        }
                    }
                    items(years.size, key = { years[it] }) { i ->
                        val y = years[i]
                        ThemeRow(y.toString(), state.year == y) {
                            showYearSheet.value = false; onYearChange(y)
                        }
                    }
                }
            }
        }
    }
}

/** Selection sheet for the theme (searchable list). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CatalogThemeSheet(state: CatalogUiState, showThemeSheet: MutableState<Boolean>, onThemeChange: (Int?) -> Unit) {
    if (showThemeSheet.value) {
        ModalBottomSheet(onDismissRequest = { showThemeSheet.value = false }) {
            var themeFilter by rememberSaveable { mutableStateOf("") }
            Column(Modifier.padding(horizontal = Spacing.large).padding(bottom = Spacing.veryLarge)) {
                Text(stringResource(R.string.catalog_filter_theme), Modifier.semantics { heading() },
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                // The shared building block, so this field too has a clear button like every
                // other search field.
                SearchField(
                    value = themeFilter,
                    onValue = { themeFilter = it },
                    placeholder = stringResource(R.string.catalog_theme_search),
                )
                val filteredThemes = remember(state.themes, themeFilter) {
                    if (themeFilter.isBlank()) state.themes
                    else state.themes.filter { it.name.contains(themeFilter, ignoreCase = true) }
                }
                LazyColumn(Modifier.heightIn(max = 420.dp).selectableGroup()) {
                    item {
                        ThemeRow(stringResource(R.string.catalog_all_themes), state.themeId == null) {
                            showThemeSheet.value = false; onThemeChange(null)
                        }
                    }
                    items(filteredThemes.size, key = { filteredThemes[it].id }) { i ->
                        val th = filteredThemes[i]
                        ThemeRow("${th.name} (${th.setCount})", state.themeId == th.id) {
                            showThemeSheet.value = false; onThemeChange(th.id)
                        }
                    }
                }
            }
        }
    }

    // ── Jahr-Auswahl ─────────────────────────────────────────────────────────
}
