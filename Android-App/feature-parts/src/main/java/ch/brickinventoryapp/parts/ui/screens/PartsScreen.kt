package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.parts.ui.Teilefilter
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.parts.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.model.domain.PartsMetricsView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.ui.components.SortierMenu
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.Filterzahl
import ch.brickinventoryapp.state.ui.LagerUiState
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.components.farbTranslator
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.SearchWithFilter
import ch.brickinventoryapp.shared.ui.ActiveFilter
import ch.brickinventoryapp.shared.ui.accountFilter
import ch.brickinventoryapp.shared.ui.storageFilter
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.shared.ui.partsBreakdown
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.parts.ui.PartsSessionUiState

/** What the parts tab shows; the route collects it from the flows. */
internal data class TeileZustand(
    val state: PartsSessionUiState,
    val blick: ScopeUiState,
    val partsState: PartsUiState,
    val storageState: LagerUiState,
)

/** The parts tab at the navigation destination: passes state and actions to [PartsScreen]. */
@Composable
fun PartsRoute(
    vm: PartsViewModel,
    imageLoader: ImageLoader,
    onOpenDetail: (partNumber: String, colorId: Int) -> Unit = { _, _ -> },
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val partsState by vm.teileState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    PartsScreen(TeileZustand(state, blick, partsState, storageState), vm, imageLoader, onOpenDetail, gridState)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PartsScreen(
    zustand: TeileZustand,
    aktionen: TeileAktionen,
    imageLoader: ImageLoader,
    /**
     * Opens the detail view of a manually entered part. Stays a parameter,
     * because only the navigation graph knows the NavController.
     */
    onOpenDetail: (partNumber: String, colorId: Int) -> Unit = { _, _ -> },
    /**
     * The list's scroll state. Comes from outside, because the destination is left when the
     * detail view opens and is recomposed afterward — a
     * `rememberLazyGridState()` in here would be reset, and the list would jump
     * to the top.
     */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state = zustand.state
    val blick = zustand.blick
    val partsState = zustand.partsState
    val storageState = zustand.storageState
    // The part whose detail is open next to it (wide window); its tile is marked.
    val gewaehlt = LocalOpenDetail.current

    val parts = partsState.parts
    val stats = partsState.partsStats
    val total = partsState.partsTotal
    val isLoading = partsState.partsFetch.laedt
    val fehler = partsState.partsFetch as? Laden.Fehler
    val errorText = fehler?.meldung?.satz()
    val currentPage = partsState.partsPage
    val colors = partsState.partsColors
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: Zustand.NEU
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ScopeFilter.View.PARTS]
        ?: ScopeFilter.ALL
    val manualParts = partsState.manualParts ?: emptyList()

    // Refreshing keeps the search text — otherwise the list would jump to the whole
    // stock while the field kept showing the text. As in the gallery (onRefresh =
    // loadSets()).
    val onRefresh: () -> Unit = { aktionen.loadParts() }
    val onSearch: (String) -> Unit = aktionen::setPartsQuery
    val onLoadMore: (Int) -> Unit = { aktionen.loadParts(page = it) }
    val onScopeChange: (String) -> Unit = { aktionen.setScope(ScopeFilter.View.PARTS, it) }
    val lagerorte = storageState.orte
    val storageMode = storageState.modi[ScopeFilter.View.PARTS] ?: ""
    val onStorageChange: (String) -> Unit = { aktionen.setStorageFilter(ScopeFilter.View.PARTS, it) }
    val ansicht = partsState.filter.ansicht
    // The SUPPLY of storage locations (not the occupied ones): on entry,
    // even an empty shelf should be offered as a choice.
    val locationStock = storageState.eigene.map { it.name }

    // The field shows what is in the state. `remember(...)` keyed on that instead of
    // `rememberSaveable`: the text lives in the ViewModel, and after navigating back
    // the field should match the list's actual filter, not its own
    // memory.
    var searchQuery by remember(partsState.filter.suche) { mutableStateOf(partsState.filter.suche) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    // Recompute the dedup only when the data changes — not on every recomposition.
    val distinctParts = remember(parts) { parts.distinctBy { "${it.partNumber}-${it.colorId}" } }
    val endReached by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= parts.size - 4 && parts.size < total && !isLoading
        }
    }
    LaunchedEffect(endReached) { if (endReached) onLoadMore(currentPage + 1) }

    var showFilter by rememberSaveable { mutableStateOf(false) }
    // Color and category — the web app's two filter lists (teile.js,
    // loadPartsFilters). The conversion to the shared shape lives here: the two
    // answers carry different field names, everything else is the same.
    val farbe = farbTranslator()
    val farbEntries = remember(partsState.partsFilterColors, farbe) {
        partsState.partsFilterColors.mapNotNull { f ->
            f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                PartsFilterEntry(
                    wert = name, text = farbe(name), anzahl = f.uniqueParts,
                    farbe = colorFromHex(f.colorHex),
                )
            }
        }
    }
    val categoryText = categoryTranslator()
    val categoryEntries = remember(partsState.partsCategories, categoryText) {
        partsState.partsCategories.mapNotNull { k ->
            k.categoryName?.takeIf { it.isNotBlank() }?.let { wert ->
                PartsFilterEntry(wert = wert, text = categoryText(k.label ?: wert), anzahl = k.uniqueParts)
            }
        }
    }

    // From large font on, "Erfassen" stands in the button row below the search (SearchWithFilter).
    val gross = largeFont()
    val addText = stringResource(R.string.parts_add)
    // Search and "filter": account, storage location, spare parts, color, category
    // and the view sit in the sheet, the key figures scroll along with the grid.
    val partsFiltered = searchQuery.isNotBlank() || Filterzahl.teile(householdMembers, scopeMode, lagerorte,
        storageMode, partsState.filter.ersatz, partsState.filter.farbe, partsState.filter.kategorie) > 0
    val anzeige = loadingIndicator(parts.isNotEmpty() || manualParts.isNotEmpty(), isLoading, errorText, partsFiltered)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // In the error state neither search nor filter — without a list there is nothing to search.
        if (anzeige != LoadingIndicator.FEHLER) SearchWithFilter(
            wert = searchQuery,
            onValue = { searchQuery = it; onSearch(it) },
            platzhalter = stringResource(R.string.parts_search_placeholder),
            activeFilter = Filterzahl.teile(householdMembers, scopeMode, lagerorte, storageMode,
                partsState.filter.ersatz, partsState.filter.farbe, partsState.filter.kategorie),
            onFilter = { showFilter = true },
            sorting = { PartsSorting(partsState.filter.order, aktionen::setPartsOrder) },
            erfassen = addText to { showAddDialog = true },
            aktive = partsFilterChips(partsState, householdMembers, scopeMode, onScopeChange, lagerorte, storageMode,
                onStorageChange, farbEntries, categoryEntries, aktionen),
        )

        OfflineHint(partsState.partsOfflineStatus, onErneut = onRefresh)
        if (anzeige == LoadingIndicator.LOADS) {
            SkeletonRaster(ReadableColumns(120.dp), kachelHoehe = 164.dp, abstand = Abstaende.klein)
        } else if (anzeige == LoadingIndicator.FEHLER) {
            StateHint { ErrorHint(errorText, onRefresh, fehler?.art) }
        } else if (anzeige == LoadingIndicator.NO_HITS) {
            // The key figures mean the whole collection; without a hit, the way back remains.
            if (stats != null) Box(Modifier.padding(Abstaende.mittel)) { PartsMetrics(stats) }
            StateHint {
                NoHitsHint()
                OutlinedButton(onClick = {
                    searchQuery = ""; onSearch("")
                    if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
                    if (Filterzahl.lager(lagerorte, storageMode) > 0) onStorageChange("")
                    if (partsState.filter.ersatz != Ersatzteilwahl.ALLE) aktionen.setPartsSpare(Ersatzteilwahl.ALLE)
                    if (partsState.filter.farbe != ColorPicker.Alle) aktionen.setPartsColorFilter(ColorPicker.Alle)
                    if (partsState.filter.kategorie != Kategoriewahl.Alle) aktionen.setPartsCategoryFilter(Kategoriewahl.Alle)
                }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.search_clear_all)) }
            }
        } else if (anzeige == LoadingIndicator.LEER) {
            // Empty without key figures: "82 Stück" next to "Keine Teile" contradicted itself.
            StateHint {
                HintText(ImageVector.vectorResource(R.drawable.ic_parts_bricks), stringResource(R.string.parts_none),
                    stringResource(R.string.parts_leer_text))
                Button(onClick = { showAddDialog = true }) { Text(addText) }
            }
        } else {
            PullToRefreshBox(isRefreshing = isLoading && parts.isNotEmpty(), onRefresh = onRefresh) {
                LazyVerticalGrid(
                    state = gridState,
                    columns = ReadableColumns(120.dp),
                    // Space at the bottom for the entry button, otherwise it covers the last row.
                    contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                        end = Abstaende.mittel, bottom = FabSpace),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
                ) {
                    if (stats != null) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "parts-stats") { PartsMetrics(stats) }
                    }
                    // Manually entered parts as a grid section instead of in a FlowRow above the grid:
                    // this way everything scrolls as one list, not just the set part.
                    if (manualParts.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.parts_manual_section))
                        }
                        items(manualParts, key = { "manual-${it.id ?: "${it.partNumber}-${it.colorId}"}" }) { part ->
                            Moved {
                                ManualPartTile(
                                    part = part,
                                    serverUrl = serverUrl,
                                    imageLoader = imageLoader,
                                    waehrung = waehrung,
                                    onEdit = { onOpenDetail(part.partNumber, part.colorId) },
                                )
                            }
                        }
                        if (distinctParts.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
                                SectionHeader(stringResource(R.string.parts_sets_section))
                            }
                        }
                    }
                    // In the table view every row takes the whole width (span =
                    // maxLineSpan). The same grid container, otherwise scroll position,
                    // infinite loading and the manual section would need maintaining twice. The manual
                    // entries stay tiles in both views, as in the web app
                    // (#manual-parts-list is not tied to parts-view).
                    items(
                        distinctParts,
                        key = { "${it.partNumber}-${it.colorId}" },
                        span = { if (ansicht == ListView.TABLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { part ->
                        // BOTH views open the same dialog — one
                        // view must not be able to do what the other cannot.
                        val oeffne = { aktionen.openSetItem(part.partNumber, part.colorId) }
                        Moved {
                            if (ansicht == ListView.TABLE) PartTableRow(part, serverUrl, imageLoader, oeffne)
                            else PartCard(part, serverUrl, imageLoader, oeffne,
                                ausgewaehlt = gewaehlt == detailKey("part", part.partNumber, part.colorId))
                        }
                    }
                    if (isLoading) {
                        // A fixed key as for the headers above — reasoning in
                        // GalleryScreen.kt.
                        item(key = "parts-loading-more", span = { GridItemSpan(maxLineSpan) }) {
                            Box(Modifier.fillMaxWidth().padding(Abstaende.gross), Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(24.dp))
                            }
                        }
                    }
                }
            }
        }
    }

        // One rule for all tabs (like gallery and wishlist): no "+" in the error state,
        // and empty, the button already stands in the middle of the image.
        if (!gross && anzeige != LoadingIndicator.FEHLER && anzeige != LoadingIndicator.LEER) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (showFilter) {
        TeileFilterBlatt(
            aktionen = aktionen,
            partsState = partsState,
            householdMembers = householdMembers,
            scopeMode = scopeMode,
            onScopeChange = onScopeChange,
            lagerorte = lagerorte,
            storageMode = storageMode,
            onStorageChange = onStorageChange,
            farbEntries = farbEntries,
            categoryEntries = categoryEntries,
            onSchliessen = { showFilter = false },
        )
    }

    if (showAddDialog) {
        AddPartDialog(
            householdMembers = householdMembers,
            colors = colors,
            onDismiss = { showAddDialog = false },
            lagerorte = locationStock,
            locationDefault = storageState.vorgabe?.name ?: "",
            onAdd = { erfassung ->
                showAddDialog = false
                aktionen.addPart(erfassung)
            },
            defaultCondition = defaultCondition
        )
    }

    // Deleted in the detail (ManualItemDetailScreen, showDeleteConfirm), not on
    // the tile.
}

/** The parts' key figures — first row of the grid, it scrolls along. */
@Composable
private fun PartsMetrics(stats: PartsMetricsView) {
    MetricsSeries {
        GalleryStatChip(stats.uniqueParts, R.plurals.parts_stat_types)
        GalleryStatChip(stats.uniqueColors, R.plurals.parts_stat_colors)
        GalleryStatChip(stats.teileGesamt, R.plurals.parts_stat_total,
            partsBreakdown(stats.partsFromSets, stats.partsSingle))
    }
}

/** The web app's sort orders (parts-ordnung), in the same shape as gallery and wishlist. */
@Composable
private fun PartsSorting(gewaehlt: Teilefilter.Order, onWahl: (Teilefilter.Order) -> Unit) {
    SortierMenu(
        optionen = Teilefilter.Order.entries.map { it to stringResource(it.beschriftung()) },
        gewaehlt = gewaehlt, onWahl = onWahl,
        vorgabe = Teilefilter.Order.FARBE,
    )
}

private fun Teilefilter.Order.beschriftung(): Int = when (this) {
    Teilefilter.Order.FARBE -> R.string.parts_ordnung_farbe
    Teilefilter.Order.NAME -> R.string.parts_ordnung_name
    Teilefilter.Order.QUANTITY -> R.string.parts_ordnung_menge
}

/** The parts' active filters as chips; each one can be removed individually, as in the sheet. */
@Composable
private fun partsFilterChips(
    partsState: PartsUiState,
    members: List<MemberView>,
    konto: String,
    onAccount: (String) -> Unit,
    orte: List<LocationView>,
    lager: String,
    onStorage: (String) -> Unit,
    farben: List<PartsFilterEntry>,
    kategorien: List<PartsFilterEntry>,
    aktionen: TeileAktionen,
): List<ActiveFilter> {
    val f = partsState.filter
    val ersatz = when (f.ersatz) {
        Ersatzteilwahl.ALLE -> null
        Ersatzteilwahl.OHNE -> R.string.parts_filter_no_spare
        Ersatzteilwahl.NUR -> R.string.parts_filter_spare
    }?.let { ActiveFilter(stringResource(it)) { aktionen.setPartsSpare(Ersatzteilwahl.ALLE) } }
    return listOfNotNull(
        accountFilter(members, konto) { onAccount(ScopeFilter.ALL) },
        storageFilter(orte, lager) { onStorage("") },
        ersatz,
        f.farbe.wert?.let { w -> ActiveFilter(farben.firstOrNull { it.wert == w }?.text ?: w) {
            aktionen.setPartsColorFilter(ColorPicker.Alle) } },
        f.kategorie.wert?.let { w -> ActiveFilter(kategorien.firstOrNull { it.wert == w }?.text ?: w) {
            aktionen.setPartsCategoryFilter(Kategoriewahl.Alle) } },
    )
}
