package ch.brickinventoryapp.ui.screens

import androidx.compose.runtime.MutableState
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.selection.selectableGroup
import ch.brickinventoryapp.ui.components.AuswahlChip
/**
 * Die Abschnitte der Katalogseite: Suchfeld, Filterzeile (Thema, Jahr, Sortierung)
 * und Trefferliste neben dem Raster. Anders als bei SetDetail und Finance
 * gewöhnliche @Composable-Funktionen, weil sie in einer `Column` stehen, nicht in
 * einer LazyColumn.
 */

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ModalBottomSheet
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.ui.text.style.TextOverflow
import ch.brickinventoryapp.ui.CatalogUiState
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.SortierMenue
import ch.brickinventoryapp.ui.components.mitSchrift

/** Filterzeile: Thema und Jahr; sortiert wird über das Menü neben der Suche. */
@Composable
fun CatalogFilterRow(state: CatalogUiState, selectedThemeName: String?, showThemeSheet: MutableState<Boolean>, showYearSheet: MutableState<Boolean>) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.padding(bottom = 6.dp)
    ) {
        item {
            AuswahlChip(
                selected = state.themeId != null,
                onClick = { showThemeSheet.value = true },
                label = {
                    Text(selectedThemeName ?: stringResource(R.string.catalog_filter_theme),
                        style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(mitSchrift(16.dp))) },
                modifier = Modifier.widthIn(max = 180.dp),
            )
        }
        item {
            AuswahlChip(
                selected = state.year != null,
                onClick = { showYearSheet.value = true },
                label = { Text(state.year?.toString() ?: stringResource(R.string.catalog_filter_year), style = MaterialTheme.typography.labelMedium) },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(mitSchrift(16.dp))) },
            )
        }
    }
}

/** Das Suchfeld über der Liste, daneben die Sortierung. */
@Composable
fun CatalogSearchField(state: CatalogUiState, onQueryChange: (String) -> Unit, onSortChange: (String) -> Unit) {
    // Suchfeld — derselbe Baustein wie in Galerie, Teilen und Minifiguren
    // (TabellenZeile.kt), damit der Leeren-Knopf überall gleich heisst.
    Row(verticalAlignment = Alignment.CenterVertically) {
        Suchfeld(
            wert = state.query,
            onWert = onQueryChange,
            platzhalter = stringResource(R.string.catalog_search_placeholder),
            modifier = Modifier.weight(1f),
        )
        SortierMenue(
            optionen = listOf("year_desc", "year_asc", "name_asc", "num_asc", "parts_desc", "parts_asc")
                .map { it to sortLabel(it) },
            gewaehlt = state.sort,
            onWahl = onSortChange,
            modifier = Modifier.padding(end = Abstaende.rand),
            vorgabe = "year_desc",
        )
    }
}

/** Auswahlblatt für das Jahr. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogYearSheet(state: CatalogUiState, showYearSheet: MutableState<Boolean>, onYearChange: (Int?) -> Unit) {
    if (showYearSheet.value) {
        ModalBottomSheet(onDismissRequest = { showYearSheet.value = false }) {
            Column(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross)) {
                Text(stringResource(R.string.catalog_filter_year), Modifier.semantics { heading() },
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(Abstaende.klein))
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

/** Auswahlblatt für das Thema (durchsuchbare Liste). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogThemeSheet(state: CatalogUiState, showThemeSheet: MutableState<Boolean>, onThemeChange: (Int?) -> Unit) {
    if (showThemeSheet.value) {
        ModalBottomSheet(onDismissRequest = { showThemeSheet.value = false }) {
            var themeFilter by rememberSaveable { mutableStateOf("") }
            Column(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross)) {
                Text(stringResource(R.string.catalog_filter_theme), Modifier.semantics { heading() },
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                // Der gemeinsame Baustein, damit auch dieses Feld einen Leeren-Knopf hat wie alle
                // anderen Suchfelder.
                Suchfeld(
                    wert = themeFilter,
                    onWert = { themeFilter = it },
                    platzhalter = stringResource(R.string.catalog_theme_search),
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
