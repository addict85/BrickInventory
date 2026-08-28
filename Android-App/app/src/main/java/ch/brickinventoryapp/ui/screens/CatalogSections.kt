package ch.brickinventoryapp.ui.screens

/**
 * Die Abschnitte der Katalogseite.
 *
 * ── Warum eigene Datei (Nachtrag 98) ────────────────────────────────────────
 *
 * `CatalogScreen()` war 339 Zeilen und enthielt neben dem Raster auch das
 * Suchfeld, die Filterzeile (Thema, Jahr, Sortierung) und die Trefferliste.
 *
 * Anders als bei SetDetail und Finance sind das hier gewöhnliche
 * @Composable-Funktionen: Sie stehen in einer `Column`, nicht in einer
 * LazyColumn.
 *
 * Jeder Rumpf ist WORTGLEICH übernommen; verändert wurde nur die Einrückung.
 */

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ModalBottomSheet
import ch.brickinventoryapp.R
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.ui.text.style.TextOverflow
import ch.brickinventoryapp.ui.CatalogUiState
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*

/** Filterzeile: Thema, Jahr, Sortierung. */
@Composable
fun CatalogFilterRow(state: CatalogUiState, selectedThemeName: String?, showThemeSheet: androidx.compose.runtime.MutableState<Boolean>, showYearSheet: androidx.compose.runtime.MutableState<Boolean>, showSortMenu: androidx.compose.runtime.MutableState<Boolean>, onSortChange: (String) -> Unit) {
    // Filter-Zeile: Thema, Jahr, Sortierung
    LazyRow(
        contentPadding = PaddingValues(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.padding(bottom = 6.dp)
    ) {
        item {
            FilterChip(
                selected = state.themeId != null,
                onClick = { showThemeSheet.value = true },
                label = {
                    Text(selectedThemeName ?: stringResource(R.string.catalog_filter_theme),
                        fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(16.dp)) },
                modifier = Modifier.widthIn(max = 180.dp),
                shape = Formen.chip
            )
        }
        item {
            FilterChip(
                selected = state.year != null,
                onClick = { showYearSheet.value = true },
                label = { Text(state.year?.toString() ?: stringResource(R.string.catalog_filter_year), fontSize = 12.sp) },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(16.dp)) },
                shape = Formen.chip
            )
        }
        item {
            Box {
                FilterChip(
                    selected = state.sort != "year_desc",
                    onClick = { showSortMenu.value = true },
                    label = { Text(sortLabel(state.sort), fontSize = 12.sp) },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Sort, null, Modifier.size(16.dp)) },
                    shape = Formen.chip
                )
                DropdownMenu(showSortMenu.value, { showSortMenu.value = false }) {
                    listOf("year_desc", "year_asc", "name_asc", "num_asc", "parts_desc", "parts_asc").forEach { s ->
                        DropdownMenuItem(
                            text = { Text(sortLabel(s)) },
                            onClick = { showSortMenu.value = false; onSortChange(s) },
                            trailingIcon = { if (state.sort == s) Icon(Icons.Default.Check, null, Modifier.size(16.dp)) }
                        )
                    }
                }
            }
        }
    }

}

/** Das Suchfeld über der Liste. */
@Composable
fun CatalogSearchField(state: CatalogUiState, onQueryChange: (String) -> Unit) {
    // Suchfeld
    OutlinedTextField(
        value = state.query,
        onValueChange = onQueryChange,
        placeholder = { Text(stringResource(R.string.catalog_search_placeholder)) },
        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(20.dp)) },
        trailingIcon = {
            if (state.query.isNotEmpty())
                IconButton(onClick = { onQueryChange("") }) { Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear)) }
        },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
        singleLine = true,
        shape = Formen.karte,
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
        )
    )

}

/** Auswahlblatt für das Jahr. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogYearSheet(state: CatalogUiState, showYearSheet: androidx.compose.runtime.MutableState<Boolean>, onYearChange: (Int?) -> Unit) {
    if (showYearSheet.value) {
        ModalBottomSheet(onDismissRequest = { showYearSheet.value = false }) {
            Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                Text(stringResource(R.string.catalog_filter_year), fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Spacer(Modifier.height(8.dp))
                val years = remember(state.yearMin, state.yearMax) {
                    val max = state.yearMax ?: 0; val min = state.yearMin ?: 0
                    if (max >= min && max > 0) (max downTo min).toList() else emptyList()
                }
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    item {
                        ThemeRow(stringResource(R.string.catalog_all_years), null, state.year == null) {
                            showYearSheet.value = false; onYearChange(null)
                        }
                    }
                    items(years.size, key = { years[it] }) { i ->
                        val y = years[i]
                        ThemeRow(y.toString(), y, state.year == y) {
                            showYearSheet.value = false; onYearChange(y)
                        }
                    }
                }
            }
        }
    }
}

/** Auswahlblatt für das Thema (durchsuchbare Liste). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogThemeSheet(state: CatalogUiState, showThemeSheet: androidx.compose.runtime.MutableState<Boolean>, onThemeChange: (Int?) -> Unit) {
    if (showThemeSheet.value) {
        ModalBottomSheet(onDismissRequest = { showThemeSheet.value = false }) {
            var themeFilter by remember { mutableStateOf("") }
            Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                Text(stringResource(R.string.catalog_filter_theme), fontWeight = FontWeight.Bold, fontSize = 17.sp)
                OutlinedTextField(
                    value = themeFilter, onValueChange = { themeFilter = it },
                    placeholder = { Text(stringResource(R.string.catalog_theme_search)) },
                    leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(18.dp)) },
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    singleLine = true, shape = Formen.knopf
                )
                val filteredThemes = remember(state.themes, themeFilter) {
                    if (themeFilter.isBlank()) state.themes
                    else state.themes.filter { it.name.contains(themeFilter, ignoreCase = true) }
                }
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    item {
                        ThemeRow(stringResource(R.string.catalog_all_themes), null, state.themeId == null) {
                            showThemeSheet.value = false; onThemeChange(null)
                        }
                    }
                    items(filteredThemes.size, key = { filteredThemes[it].id }) { i ->
                        val th = filteredThemes[i]
                        ThemeRow("${th.name} (${th.setCount})", th.id, state.themeId == th.id) {
                            showThemeSheet.value = false; onThemeChange(th.id)
                        }
                    }
                }
            }
        }
    }

    // ── Jahr-Auswahl ─────────────────────────────────────────────────────────
}
