package ch.brickinventoryapp.ui.screens

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

/** Filterzeile: Thema und Jahr; sortiert wird über das Menü neben der Suche. */
@Composable
fun CatalogFilterRow(state: CatalogUiState, selectedThemeName: String?, showThemeSheet: androidx.compose.runtime.MutableState<Boolean>, showYearSheet: androidx.compose.runtime.MutableState<Boolean>) {
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
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp))) },
                modifier = Modifier.widthIn(max = 180.dp),
            )
        }
        item {
            AuswahlChip(
                selected = state.year != null,
                onClick = { showYearSheet.value = true },
                label = { Text(state.year?.toString() ?: stringResource(R.string.catalog_filter_year), style = MaterialTheme.typography.labelMedium) },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp))) },
            )
        }
    }
}

/** Das Suchfeld über der Liste, daneben die Sortierung. */
@Composable
fun CatalogSearchField(state: CatalogUiState, onQueryChange: (String) -> Unit, onSortChange: (String) -> Unit) {
    // Suchfeld — derselbe Baustein wie in Galerie, Teilen und Minifiguren
    // (TabellenZeile.kt), damit der Leeren-Knopf überall gleich heisst.
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Suchfeld(
            wert = state.query,
            onWert = onQueryChange,
            platzhalter = stringResource(R.string.catalog_search_placeholder),
            modifier = Modifier.weight(1f),
        )
        ch.brickinventoryapp.ui.components.SortierMenue(
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
fun CatalogYearSheet(state: CatalogUiState, showYearSheet: androidx.compose.runtime.MutableState<Boolean>, onYearChange: (Int?) -> Unit) {
    if (showYearSheet.value) {
        ModalBottomSheet(onDismissRequest = { showYearSheet.value = false }) {
            Column(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross)) {
                Text(stringResource(R.string.catalog_filter_year), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(Abstaende.klein))
                val years = remember(state.yearMin, state.yearMax) {
                    val max = state.yearMax ?: 0; val min = state.yearMin ?: 0
                    if (max >= min && max > 0) (max downTo min).toList() else emptyList()
                }
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 420.dp)) {
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
fun CatalogThemeSheet(state: CatalogUiState, showThemeSheet: androidx.compose.runtime.MutableState<Boolean>, onThemeChange: (Int?) -> Unit) {
    if (showThemeSheet.value) {
        ModalBottomSheet(onDismissRequest = { showThemeSheet.value = false }) {
            var themeFilter by rememberSaveable { mutableStateOf("") }
            Column(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross)) {
                Text(stringResource(R.string.catalog_filter_theme), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
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
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 420.dp)) {
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
