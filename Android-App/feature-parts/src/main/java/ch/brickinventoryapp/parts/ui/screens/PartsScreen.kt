package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.parts.ui.viewmodel.PartsActions
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ActiveFilter
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.SearchWithFilter
import ch.brickinventoryapp.shared.ui.accountFilter
import ch.brickinventoryapp.shared.ui.partsBreakdown
import ch.brickinventoryapp.shared.ui.storageFilter
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
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.ui.components.colorTranslator
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.uistate.ListView
import ch.brickinventoryapp.uistate.Load
import ch.brickinventoryapp.uistate.loading
import coil3.ImageLoader

/** What the parts tab shows; the route collects it from the flows. */
internal data class PartsState(
    val state: PartsSessionUiState,
    val glance: ScopeUiState,
    val partsState: PartsUiState,
    val storageState: StorageUiState,
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
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    PartsScreen(PartsState(state, glance, partsState, storageState), vm, imageLoader, onOpenDetail, gridState)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PartsScreen(
    condition: PartsState,
    actions: PartsActions,
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
    val partsState = condition.partsState
    val storageState = condition.storageState
    val parts = partsState.parts
    val isLoading = partsState.partsFetch.loading
    val errorText = (partsState.partsFetch as? Load.Failure)?.message?.sentence()
    val filter = rememberPartsFilter(partsState, condition.glance, storageState, actions)

    // Refreshing keeps the search text — otherwise the list would jump to the whole
    // stock while the field kept showing the text. As in the gallery (onRefresh =
    // loadSets()).
    val onRefresh: () -> Unit = { actions.loadParts() }

    // The field shows what is in the state. `remember(...)` keyed on that instead of
    // `rememberSaveable`: the text lives in the ViewModel, and after navigating back
    // the field should match the list's actual filter, not its own
    // memory.
    var searchQuery by remember(partsState.filter.search) { mutableStateOf(partsState.filter.search) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    val endReached by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= parts.size - 4 && parts.size < partsState.partsTotal && !isLoading
        }
    }
    val onLoadMore: (Int) -> Unit = { actions.loadParts(page = it) }
    LaunchedEffect(endReached) { if (endReached) onLoadMore(partsState.partsPage + 1) }

    var showFilter by rememberSaveable { mutableStateOf(false) }
    // From large font on, "Erfassen" stands in the button row below the search (SearchWithFilter).
    val large = largeFont()
    val addText = stringResource(R.string.parts_add)
    val display = loadingIndicator(parts.isNotEmpty() || !partsState.manualParts.isNullOrEmpty(), isLoading, errorText,
        searchQuery.isNotBlank() || filter.activeCount() > 0)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Search and "filter": account, storage location, spare parts, color, category
        // and the view sit in the sheet, the key figures scroll along with the grid.
        // In the error state neither search nor filter — without a list there is nothing to search.
        if (display != LoadingIndicator.ERROR) SearchWithFilter(
            value = searchQuery,
            onValue = { searchQuery = it; actions.setPartsQuery(it) },
            placeholder = stringResource(R.string.parts_search_placeholder),
            activeFilter = filter.activeCount(),
            onFilter = { showFilter = true },
            sorting = { PartsSorting(partsState.filter.order, actions::setPartsOrder) },
            record = addText to { showAddDialog = true },
            active = partsFilterChips(filter),
        )

        OfflineHint(partsState.partsOfflineStatus, onAgain = onRefresh)
        PartsContent(display, partsState, errorText, onRefresh,
            onReset = { searchQuery = ""; actions.setPartsQuery(""); filter.reset() },
            onAdd = { showAddDialog = true }) {
            PullToRefreshBox(isRefreshing = isLoading && parts.isNotEmpty(), onRefresh = onRefresh) {
                PartsGrid(partsState, gridState, PartTiles(condition.state, imageLoader, onOpenDetail, actions))
            }
        }
    }

        // One rule for all tabs (like gallery and wishlist): no "+" in the error state,
        // and empty, the button already stands in the middle of the image.
        if (!large && display != LoadingIndicator.ERROR && display != LoadingIndicator.EMPTY) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Spacing.large),
        )
    }

    if (showFilter) PartsFilterSheet(filter, onClose = { showFilter = false })

    if (showAddDialog) PartEntryDialog(condition, actions) { showAddDialog = false }

    // Deleted in the detail (ManualItemDetailScreen, showDeleteConfirm), not on
    // the tile.
}

/** The entry dialog for a single part, with the account's storage locations and default condition. */
@Composable
private fun PartEntryDialog(condition: PartsState, actions: PartsActions, onClose: () -> Unit) {
    val storageState = condition.storageState
    AddPartDialog(
        householdMembers = condition.glance.householdMembers,
        colors = condition.partsState.partsColors,
        onDismiss = onClose,
        // The SUPPLY of storage locations (not the occupied ones): on entry,
        // even an empty shelf should be offered as a choice.
        storageLocations = storageState.own.map { it.name },
        locationDefault = storageState.default?.name ?: "",
        onAdd = { entry ->
            onClose()
            actions.addPart(entry)
        },
        defaultCondition = condition.state.userDefaultCondition ?: Condition.NEW
    )
}

/** Skeleton, error, no hits (with the way back) or empty — otherwise [list]. */
@Composable
private fun PartsContent(
    display: LoadingIndicator,
    partsState: PartsUiState,
    errorText: String?,
    onRefresh: () -> Unit,
    onReset: () -> Unit,
    onAdd: () -> Unit,
    list: @Composable () -> Unit,
) {
    val stats = partsState.partsStats
    when (display) {
        LoadingIndicator.LOADS -> SkeletonRaster(ReadableColumns(120.dp), tileHeight = 164.dp, spacing = Spacing.small)
        LoadingIndicator.ERROR -> StateHint { ErrorHint(errorText, onRefresh, (partsState.partsFetch as? Load.Failure)?.kind) }
        LoadingIndicator.NO_HITS -> {
            // The key figures mean the whole collection; without a hit, the way back remains.
            if (stats != null) Box(Modifier.padding(Spacing.medium)) { PartsMetrics(stats) }
            StateHint {
                NoHitsHint()
                OutlinedButton(onClick = onReset, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
                    Text(stringResource(R.string.search_clear_all))
                }
            }
        }
        // Empty without key figures: "82 Stück" next to "Keine Teile" contradicted itself.
        LoadingIndicator.EMPTY -> StateHint {
            HintText(ImageVector.vectorResource(R.drawable.ic_parts_bricks), stringResource(R.string.parts_none),
                stringResource(R.string.parts_empty_text))
            Button(onClick = onAdd) { Text(stringResource(R.string.parts_add)) }
        }
        else -> list()
    }
}

/** How a part becomes a tile or a table row, and where tapping it leads. */
private class PartTiles(
    val state: PartsSessionUiState,
    val imageLoader: ImageLoader,
    val onOpenDetail: (partNumber: String, colorId: Int) -> Unit,
    val actions: PartsActions,
)

/** Key figures, the manually entered parts, then the parts from sets; more pages load at the end. */
@Composable
private fun PartsGrid(partsState: PartsUiState, gridState: LazyGridState, tiles: PartTiles) {
    val parts = partsState.parts
    val stats = partsState.partsStats
    val manualParts = partsState.manualParts ?: emptyList()
    // Recompute the dedup only when the data changes — not on every recomposition.
    val distinctParts = remember(parts) { parts.distinctBy { "${it.partNumber}-${it.colorId}" } }
    // The part whose detail is open next to it (wide window); its tile is marked.
    val chosen = LocalOpenDetail.current
    val view = partsState.filter.view
    val serverUrl = tiles.state.serverUrl
    val imageLoader = tiles.imageLoader
    LazyVerticalGrid(
        state = gridState,
        columns = ReadableColumns(120.dp),
        // Space at the bottom for the entry button, otherwise it covers the last row.
        contentPadding = PaddingValues(start = Spacing.medium, top = Spacing.medium,
            end = Spacing.medium, bottom = FabSpace),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        verticalArrangement = Arrangement.spacedBy(Spacing.small)
    ) {
        if (stats != null) {
            item(span = { GridItemSpan(maxLineSpan) }, key = "parts-stats") { PartsMetrics(stats) }
        }
        if (partsState.extrasFetch is Load.Failure) {
            item(span = { GridItemSpan(maxLineSpan) }, key = "parts-extras-failed") {
                PartialLoadFailed(partsState.extrasFetch, tiles.actions::retryExtras)
            }
        }
        // Manually entered parts as a grid section instead of in a FlowRow above the grid:
        // this way everything scrolls as one list, not just the set part.
        if (manualParts.isNotEmpty()) manualPartsSection(manualParts, tiles, setsFollow = distinctParts.isNotEmpty())
        // In the table view every row takes the whole width (span =
        // maxLineSpan). The same grid container, otherwise scroll position,
        // infinite loading and the manual section would need maintaining twice. The manual
        // entries stay tiles in both views, as in the web app
        // (#manual-parts-list is not tied to parts-view).
        items(
            distinctParts,
            key = { "${it.partNumber}-${it.colorId}" },
            span = { if (view == ListView.TABLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
        ) { part ->
            // BOTH views open the same dialog — one
            // view must not be able to do what the other cannot.
            val open = { tiles.actions.openSetItem(part.partNumber, part.colorId) }
            Moved {
                if (view == ListView.TABLE) PartTableRow(part, serverUrl, imageLoader, open)
                else PartCard(part, serverUrl, imageLoader, open,
                    picked = chosen == detailKey("part", part.partNumber, part.colorId))
            }
        }
        if (partsState.partsFetch.loading) {
            // A fixed key as for the headers above — reasoning in
            // GalleryScreen.kt.
            item(key = "parts-loading-more", span = { GridItemSpan(maxLineSpan) }) {
                Box(Modifier.fillMaxWidth().padding(Spacing.large), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
            }
        }
    }
}

/** The manually entered parts with their heading; the sets' heading follows if there are any. */
private fun LazyGridScope.manualPartsSection(manualParts: List<ManualPartView>, tiles: PartTiles, setsFollow: Boolean) {
    item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
        SectionHeader(stringResource(R.string.parts_manual_section))
    }
    items(manualParts, key = { "manual-${it.id ?: "${it.partNumber}-${it.colorId}"}" }) { part ->
        Moved {
            ManualPartTile(
                part = part,
                serverUrl = tiles.state.serverUrl,
                imageLoader = tiles.imageLoader,
                currency = tiles.state.currency,
                onEdit = { tiles.onOpenDetail(part.partNumber, part.colorId) },
            )
        }
    }
    if (setsFollow) {
        item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
            SectionHeader(stringResource(R.string.parts_sets_section))
        }
    }
}

/**
 * The parts' filter as the sheet and the chips see it: account, storage location, spare parts,
 * color and category. The color and category lists are converted to the shared shape here: the
 * two answers carry different field names, everything else is the same.
 */
internal class PartsFilterContext(
    val partsState: PartsUiState,
    val members: List<MemberView>,
    val account: String,
    val locations: List<LocationView>,
    val storage: String,
    val colors: List<PartsFilterEntry>,
    val categories: List<PartsFilterEntry>,
    val actions: PartsActions,
) {
    fun onAccount(value: String) = actions.setScope(ScopeFilter.View.PARTS, value)
    fun onStorage(value: String) = actions.setStorageFilter(ScopeFilter.View.PARTS, value)

    fun activeCount(): Int = FilterCount.parts(members, account, locations, storage,
        partsState.filter.spare, partsState.filter.color, partsState.filter.category)

    /** Resets only what deviates: every change reloads the list. */
    fun reset() {
        if (FilterCount.account(members, account) > 0) onAccount(ScopeFilter.ALL)
        if (FilterCount.storage(locations, storage) > 0) onStorage("")
        if (partsState.filter.spare != SparePartChoice.ALL) actions.setPartsSpare(SparePartChoice.ALL)
        if (partsState.filter.color != ColorPicker.All) actions.setPartsColorFilter(ColorPicker.All)
        if (partsState.filter.category != CategoryChoice.All) actions.setPartsCategoryFilter(CategoryChoice.All)
    }
}

/** Color and category — the web app's two filter lists (`teile.js`, loadPartsFilters). */
@Composable
private fun rememberPartsFilter(
    partsState: PartsUiState,
    glance: ScopeUiState,
    storageState: StorageUiState,
    actions: PartsActions,
): PartsFilterContext {
    val color = colorTranslator()
    val colorEntries = remember(partsState.partsFilterColors, color) {
        partsState.partsFilterColors.mapNotNull { f ->
            f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                PartsFilterEntry(
                    value = name, text = color(name), count = f.uniqueParts,
                    color = colorFromHex(f.colorHex),
                )
            }
        }
    }
    val categoryText = categoryTranslator()
    val categoryEntries = remember(partsState.partsCategories, categoryText) {
        partsState.partsCategories.mapNotNull { k ->
            k.categoryName?.takeIf { it.isNotBlank() }?.let { value ->
                PartsFilterEntry(value = value, text = categoryText(k.label ?: value), count = k.uniqueParts)
            }
        }
    }
    return PartsFilterContext(
        partsState = partsState,
        members = glance.householdMembers,
        account = glance.scopeModes[ScopeFilter.View.PARTS] ?: ScopeFilter.ALL,
        locations = storageState.locations,
        storage = storageState.modes[ScopeFilter.View.PARTS] ?: "",
        colors = colorEntries,
        categories = categoryEntries,
        actions = actions,
    )
}

/** The parts' key figures — first row of the grid, it scrolls along. */
@Composable
private fun PartsMetrics(stats: PartsMetricsView) {
    MetricsSeries {
        GalleryStatChip(stats.uniqueParts, R.plurals.parts_stat_types)
        GalleryStatChip(stats.uniqueColors, R.plurals.parts_stat_colors)
        GalleryStatChip(stats.partsTotal, R.plurals.parts_stat_total,
            partsBreakdown(stats.partsFromSets, stats.partsSingle))
    }
}

/** The web app's sort orders (parts-ordnung), in the same shape as gallery and wishlist. */
@Composable
private fun PartsSorting(chosen: PartsFilter.Order, onChoice: (PartsFilter.Order) -> Unit) {
    SortMenu(
        options = PartsFilter.Order.entries.map { it to stringResource(it.label()) },
        chosen = chosen, onChoice = onChoice,
        default = PartsFilter.Order.COLOR,
    )
}

private fun PartsFilter.Order.label(): Int = when (this) {
    PartsFilter.Order.COLOR -> R.string.parts_order_color
    PartsFilter.Order.NAME -> R.string.parts_order_name
    PartsFilter.Order.QUANTITY -> R.string.parts_order_quantity
}

/** The parts' active filters as chips; each one can be removed individually, as in the sheet. */
@Composable
private fun partsFilterChips(filter: PartsFilterContext): List<ActiveFilter> {
    val f = filter.partsState.filter
    val actions = filter.actions
    val spare = when (f.spare) {
        SparePartChoice.ALL -> null
        SparePartChoice.WITHOUT -> R.string.parts_filter_no_spare
        SparePartChoice.ONLY -> R.string.parts_filter_spare
    }?.let { ActiveFilter(stringResource(it)) { actions.setPartsSpare(SparePartChoice.ALL) } }
    return listOfNotNull(
        accountFilter(filter.members, filter.account) { filter.onAccount(ScopeFilter.ALL) },
        storageFilter(filter.locations, filter.storage) { filter.onStorage("") },
        spare,
        f.color.value?.let { w -> ActiveFilter(filter.colors.firstOrNull { it.value == w }?.text ?: w) {
            actions.setPartsColorFilter(ColorPicker.All) } },
        f.category.value?.let { w -> ActiveFilter(filter.categories.firstOrNull { it.value == w }?.text ?: w) {
            actions.setPartsCategoryFilter(CategoryChoice.All) } },
    )
}
