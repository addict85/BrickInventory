package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureOrder
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.parts.ui.MinifigsUiState
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.parts.ui.viewmodel.FiguresActions
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.AccountFilterSection
import ch.brickinventoryapp.shared.ui.FilterSheetFrame
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.SearchWithFilter
import ch.brickinventoryapp.shared.ui.ViewSection
import ch.brickinventoryapp.shared.ui.accountFilter
import ch.brickinventoryapp.state.ui.FilterCount
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.PartialLoadFailed
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.SortMenu
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import coil3.ImageLoader

/** What the figures tab shows; the route collects it from the flows. */
internal data class FiguresState(
    val session: PartsSessionUiState,
    val glance: ScopeUiState,
    val figures: MinifigsUiState,
    val storage: StorageUiState,
)

/** The figures tab at the navigation destination: passes state and actions to [MinifigsScreen]. */
@Composable
fun MinifigsRoute(
    vm: MinifigsViewModel,
    imageLoader: ImageLoader,
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.sessionValues.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val figures by vm.minifigsState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    MinifigsScreen(FiguresState(state, glance, figures, storageState), vm, imageLoader, onOpenDetail, gridState)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun MinifigsScreen(
    condition: FiguresState,
    actions: FiguresActions,
    imageLoader: ImageLoader,
    /** Opens the detail view — only the graph knows the NavController. */
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    /** Scroll state from outside: the target is discarded when a detail is opened. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state = condition.session
    val glance = condition.glance
    val partsState = condition.figures

    val figs = partsState.minifigs
    val minifigStats = partsState.minifigStats
    val isLoading = partsState.minifigsFetch.loading
    val error = partsState.minifigsFetch as? Load.Failure
    val errorText = error?.message?.sentence()
    val serverUrl = state.serverUrl
    val currency = state.currency
    val defaultCondition = state.userDefaultCondition ?: Condition.NEW
    val householdMembers = glance.householdMembers
    val scopeMode = glance.scopeModes[ScopeFilter.View.MINIFIGS]
        ?: ScopeFilter.ALL
    val manualFigs = partsState.manualFigs ?: emptyList()
    val storageState = condition.storage
    // The figure whose detail is open next to it (wide window); its tile is marked.
    val chosen = LocalOpenDetail.current

    val onRefresh: () -> Unit = { actions.loadMinifigs() }
    val onScopeChange: (String) -> Unit = { actions.setScope(ScopeFilter.View.MINIFIGS, it) }
    // The SUPPLY of storage locations (not the occupied ones): on entry,
    // even an empty shelf should be offered as a choice.
    val locationStock = storageState.own.map { it.name }

    // Search text from the state, filtering happens on the server — as with the parts and
    // in the gallery, so that the search rule exists only once (reasoning in
    // PartsRepository.getMinifigs). remember(partsState.minifigsQuery): the field holds
    // the text itself while typing, but takes over one set from outside (clearing
    // on sign-out, restoring).
    var search by remember(partsState.minifigsQuery) { mutableStateOf(partsState.minifigsQuery) }
    val view = partsState.minifigsView
    var showAddDialog by rememberSaveable { mutableStateOf(false) }

    var showFilter by rememberSaveable { mutableStateOf(false) }

    // From large font on, "Erfassen" stands in the button row below the search (SearchWithFilter).
    val large = largeFont()
    val addText = stringResource(R.string.minifigs_add)
    // Previously the "no results" case stood behind the same condition as "empty"
    // and was unreachable; a load error looked like an empty collection.
    val minifigsFiltered = search.isNotBlank() || FilterCount.account(householdMembers, scopeMode) > 0
    val display = loadingIndicator(figs.isNotEmpty() || manualFigs.isNotEmpty(), isLoading, errorText, minifigsFiltered)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Search and "filter": account and view sit in the sheet, the key figures scroll along
        // with the grid. Not in the error state — without a list there is nothing to search.
        if (display != LoadingIndicator.ERROR) SearchWithFilter(
            value = search,
            onValue = { search = it; actions.setMinifigsQuery(it) },
            placeholder = stringResource(R.string.minifigs_search_placeholder),
            activeFilter = FilterCount.account(householdMembers, scopeMode),
            onFilter = { showFilter = true },
            sorting = {
                SortMenu(
                    options = FigureOrder.entries.map { it to stringResource(it.label()) },
                    chosen = partsState.order, onChoice = actions::setMinifigsOrder,
                    default = FigureOrder.DEFAULT,
                )
            },
            record = addText to { showAddDialog = true },
            active = listOfNotNull(accountFilter(householdMembers, scopeMode) { onScopeChange(ScopeFilter.ALL) }),
        )

        OfflineHint(partsState.minifigsOfflineStatus, onAgain = onRefresh)
        when (display) {
            LoadingIndicator.LOADS ->
                SkeletonRaster(ReadableColumns(140.dp), tileHeight = 196.dp)
            LoadingIndicator.ERROR -> StateHint { ErrorHint(errorText, onRefresh, error?.kind) }
            // Like the empty parts tab: sentence and action, no key figures next to "empty".
            LoadingIndicator.EMPTY -> StateHint {
                HintText(Icons.Default.Person, stringResource(R.string.minifigs_none),
                    stringResource(R.string.minifigs_empty_text))
                Button(onClick = { showAddDialog = true }) { Text(addText) }
            }
            LoadingIndicator.NO_HITS -> StateHint {
                NoHitsHint(stringResource(R.string.minifigs_no_results))
                OutlinedButton(onClick = {
                    search = ""; actions.setMinifigsQuery("")
                    if (FilterCount.account(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
                }, colors = secondaryButtonColors(), border = secondaryButtonRand()) { Text(stringResource(R.string.search_clear_all)) }
            }
            LoadingIndicator.LIST -> PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
                LazyVerticalGrid(
                    columns = ReadableColumns(140.dp),
                    state = gridState,
                    // Space at the bottom for the entry button, otherwise it covers the last row.
                    contentPadding = PaddingValues(start = Spacing.medium, top = Spacing.medium,
                        end = Spacing.medium, bottom = FabSpace),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                    verticalArrangement = Arrangement.spacedBy(Spacing.small)
                ) {
                    // Asked for the content, not the loaded page: the
                    // numbers mean the whole collection, even during a search.
                    if (minifigStats.types > 0 || minifigStats.totalQuantity > 0) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "figs-stats") { MinifigsMetrics(minifigStats) }
                    }
                    if (partsState.metricsFetch is Load.Failure) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "figs-metrics-failed") {
                            PartialLoadFailed(partsState.metricsFetch, actions::retryMetrics)
                        }
                    }
                    // Manual figures as a grid section — one continuous
                    // scroll list instead of a fixed block above the grid (see PartsScreen).
                    if (manualFigs.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.minifigs_manual_section))
                        }
                        items(manualFigs, key = { "manual-${it.id ?: it.figNumber}" }) { fig ->
                            Moved {
                                ManualFigTile(
                                    fig = fig,
                                    serverUrl = serverUrl,
                                    imageLoader = imageLoader,
                                    currency = currency,
                                    onEdit = { onOpenDetail(fig.figNumber) },
                                )
                            }
                        }
                        if (figs.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
                                SectionHeader(stringResource(R.string.minifigs_sets_section))
                            }
                        }
                    }
                    // As with the parts: in the table view every row takes the whole width,
                    // the grid container stays the same. The manual figures stay tiles in both
                    // views — like #manual-figs-list in the web app, which is not tied to
                    // figs-view.
                    itemsIndexed(
                        figs,
                        key = { index, fig -> "${fig.figNumber}_${fig.source}_$index" },
                        span = { _, _ -> if (view == ListView.TABLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { _, fig ->
                        // BOTH views open the same dialog.
                        val open = { actions.openSetItem(fig.figNumber) }
                        Moved {
                            if (view == ListView.TABLE) MinifigTableRow(fig, serverUrl, imageLoader, open)
                            else MinifigCard(fig, serverUrl, imageLoader, open,
                                picked = chosen == detailKey("fig", fig.figNumber))
                        }
                    }
                }
            }
        }
    }

        // Like the gallery, parts and wishlist: no "+" in the error state, empty it stands in the image.
        if (!large && display != LoadingIndicator.ERROR && display != LoadingIndicator.EMPTY) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Spacing.large),
        )
    }

    if (showFilter) {
        val reset: () -> Unit = { onScopeChange(ScopeFilter.ALL) }
        FilterSheetFrame(
            onClose = { showFilter = false },
            resetOn = reset.takeIf { FilterCount.account(householdMembers, scopeMode) > 0 },
        ) {
            AccountFilterSection(householdMembers, scopeMode, onScopeChange)
            ViewSection(view) { actions.setMinifigsView(it) }
        }
    }

    if (showAddDialog) {
        AddMinifigDialog(
            householdMembers = householdMembers,
            defaultCondition = defaultCondition,
            onDismiss = { showAddDialog = false },
            storageLocations = locationStock,
            locationDefault = storageState.default?.name ?: "",
            onAdd = { entry ->
                showAddDialog = false
                actions.addMinifig(entry)
            }
        )
    }

    // Deleted in the detail (ManualItemDetailScreen, showDeleteConfirm) — at
    // the same spot as for the set.
}

/** The minifigures' key figures — first row of the grid, it scrolls along. */
@Composable
private fun MinifigsMetrics(minifigStats: MinifigsMetricsView) {
    MetricsSeries {
        // Numbers from the server (getMinifigStats): computed from the list, the
        // manually entered figures, which are filtered out here, would be missing.
        GalleryStatChip(minifigStats.types, R.plurals.minifigs_stat_types)
        GalleryStatChip(minifigStats.totalQuantity, R.plurals.minifigs_stat_total)
        GalleryStatChip(minifigStats.manual, R.plurals.minifigs_stat_manual)
    }
}

private fun FigureOrder.label(): Int = when (this) {
    FigureOrder.NAME -> R.string.parts_order_name
    FigureOrder.NUMBER -> R.string.minifigs_order_number
    FigureOrder.QUANTITY -> R.string.parts_order_quantity
}
