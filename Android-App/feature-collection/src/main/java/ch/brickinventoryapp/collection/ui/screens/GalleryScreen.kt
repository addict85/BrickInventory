package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.GalleryDisplay
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.galleryDisplay
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.WantedSort
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
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
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.BarcodeSymbol
import ch.brickinventoryapp.ui.components.ButtonStack
import ch.brickinventoryapp.ui.components.EmptySymbol
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.SortMenu
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import coil3.ImageLoader

/** What the gallery shows; the route gathers it from the ViewModels' flows. */
internal data class GalleryState(
    val app: AppUiState,
    val glance: ScopeUiState,
    val gallery: GalleryUiState,
    val prices: Map<String, TilePrice>,
    val barcode: BarcodeUiState,
    val storage: StorageUiState,
)

/** What the gallery triggers; the route wires it to GalleryViewModel and EntryViewModel. */
internal class GalleryEvents(
    val search: (String) -> Unit,
    val theme: (String) -> Unit,
    val sorting: (SetSort) -> Unit,
    val account: (String) -> Unit,
    val storageLocation: (String) -> Unit,
    val refresh: () -> Unit,
    val setRecord: (EntryRequest) -> Unit,
    val manualEntryAcknowledged: () -> Unit,
)

/**
 * "deleted" with "Undo". Only deleted once the snackbar ends without Undo —
 * even if it disappears because you leave the gallery. Every snackbar
 * answers only for its own set: if a second delete replaces it, its Undo remains.
 */
@Composable
internal fun GalleryUndoRoute(vm: GalleryViewModel, snackbarHostState: SnackbarHostState) {
    val marked by vm.marked.collectAsStateWithLifecycle()
    val text = marked?.let { stringResource(R.string.vm_set_deleted, it.name) }
    val undo = stringResource(R.string.common_undo)
    LaunchedEffect(marked) {
        val v = marked ?: return@LaunchedEffect
        var back = false
        try {
            back = snackbarHostState.showSnackbar(text ?: v.name, undo,
                duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed
        } finally {
            if (back) vm.undo(v) else vm.executeDelete(v)
        }
    }
}

/** The gallery at the navigation destination: gathers the flows and passes state and events on. */
@Composable
fun GalleryRoute(
    vm: GalleryViewModel,
    /** This destination's entry flow; the graph binds it to its entry. */
    entryVm: EntryViewModel,
    imageLoader: ImageLoader,
    /** Open the barcode scanner — only the graph knows the NavController. */
    onScanBarcode: () -> Unit,
    /** Clicking a set, likewise. */
    onSetClick: (String) -> Unit,
    /** Scroll state from outside, so it survives the trip to the detail view. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    // Its own flow for the gallery: paging, searching and refetching only change
    // THIS state (see GalleryUiState).
    val gallery by vm.galleryState.collectAsStateWithLifecycle()
    val prices by vm.prices.collectAsStateWithLifecycle()
    val barcodeState by entryVm.barcodeState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    val events = remember(vm, entryVm) {
        GalleryEvents(
            search = vm::setGalleryQuery,
            theme = vm::setGalleryTheme,
            sorting = vm::setGallerySort,
            account = { vm.setScope(ScopeFilter.View.GALLERY, it) },
            storageLocation = { vm.setStorageFilter(ScopeFilter.View.GALLERY, it) },
            // The filter lists too: otherwise they'd only load on start.
            refresh = vm::refresh,
            setRecord = entryVm::addSet,
            manualEntryAcknowledged = { entryVm.acknowledgeManualEntry() },
        )
    }
    GalleryScreen(
        condition = GalleryState(state, glance, gallery, prices, barcodeState, storageState),
        events = events,
        imageLoader = imageLoader,
        onScanBarcode = onScanBarcode,
        onSetClick = onSetClick,
        gridState = gridState,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GalleryScreen(
    condition: GalleryState,
    events: GalleryEvents,
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    onSetClick: (String) -> Unit,
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val gallery = condition.gallery
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var showAddMenu by rememberSaveable { mutableStateOf(false) }

    // ── An unsuccessful scan opens manual entry ──
    //
    // The unsuccessful paths (EAN not resolvable, no set number, text recognition with no
    // hit) report via a field in the state; collected and acknowledged here,
    // otherwise the dialog would open again on the next recomposition.
    LaunchedEffect(condition.barcode.requestManualEntry) {
        if (condition.barcode.requestManualEntry) {
            showAddDialog = true
            events.manualEntryAcknowledged()
        }
    }
    // The input field holds its own text (typing stays smooth); the
    // debouncing and the fetch live in the ViewModel, because the
    // filter generation also lives there. If the value changes from outside (sign-in,
    // reset), the field follows.
    var searchInput by remember(gallery.galleryQuery) { mutableStateOf(gallery.galleryQuery) }
    var showFilter by rememberSaveable { mutableStateOf(false) }

    // No local filtering and no theme list from `sets`: the screen shows what the
    // server delivered — a second search here would know neither year nor sorting,
    // and the themes would come from the loaded page instead of the whole inventory.

    val display = galleryDisplay(gallery, filtered = searchInput.isNotBlank() || gallery.galleryTheme.isNotEmpty())
    // From large font size on, Add sits in the button row below the search (SearchWithFilter).
    val large = largeFont()
    val addText = stringResource(R.string.gallery_add_set)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Search and one button for everything else: account, storage location, theme and
            // sorting live in the sheet; the figures scroll with the grid. The FAB below asks
            // manual or scan, so only ONE button floats at the bottom. Not in the error state:
            // without a collection there's nothing to search.
            if (display != GalleryDisplay.ERROR && display != GalleryDisplay.EMPTY) GallerySearch(
                condition, events, searchInput, { searchInput = it }, onScanBarcode,
                onFilter = { showFilter = true }, record = addText to { showAddDialog = true },
            )

            OfflineHint(gallery.offlineStatus, onAgain = events.refresh)
            // The drag spinner only over a list: on the first load the
            // skeleton already shows that something is coming, two loading indicators stacked felt restless.
            PullToRefreshBox(isRefreshing = gallery.fetch.loading && display == GalleryDisplay.LIST,
                             onRefresh = events.refresh, modifier = Modifier.fillMaxSize()) {
                GalleryContent(display, condition, searchInput, onRefresh = events.refresh,
                    empty = { GalleryEmpty(addOn = { showAddDialog = true }, onScanBarcode) },
                ) { GalleryRaster(condition, imageLoader, gridState, onSetClick) }
            }
        }

        // Add only once the collection is there: in the error state, attention belongs to the
        // reason and "Try again", not a button that would go nowhere.
        // Not empty either: the empty message itself offers Add and Scan.
        if (!large && display != GalleryDisplay.ERROR && display != GalleryDisplay.EMPTY) Box(
            Modifier.align(Alignment.BottomEnd).padding(Spacing.large),
        ) {
            AddFab(addText, { showAddMenu = true })
            // The FAB is the one entry point for capture; it asks manual or scan
            // instead of floating a second button next to the search field.
            DropdownMenu(showAddMenu, { showAddMenu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.gallery_add_manually)) },
                    leadingIcon = { Icon(Icons.Default.Add, null) },
                    onClick = { showAddMenu = false; showAddDialog = true },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.gallery_scan_barcode)) },
                    leadingIcon = { Icon(BarcodeSymbol, null) },
                    onClick = { showAddMenu = false; onScanBarcode() },
                )
            }
        }
    }

    if (showFilter) GalleryFilter(condition, events, onClose = { showFilter = false })
    if (showAddDialog) GalleryRecord(condition, events, onClose = { showAddDialog = false })
}

/** The gallery's account scope and chosen storage location. */
internal fun GalleryState.accountChoice(): String =
    glance.scopeModes[ScopeFilter.View.GALLERY] ?: ScopeFilter.ALL

internal fun GalleryState.storageChoice(): String =
    storage.modes[ScopeFilter.View.GALLERY] ?: ""

/** Search, filter button, scan and sort above the grid. */
@Composable
private fun GallerySearch(
    condition: GalleryState,
    events: GalleryEvents,
    searchText: String,
    onSearchText: (String) -> Unit,
    onScanBarcode: () -> Unit,
    onFilter: () -> Unit,
    record: Pair<String, () -> Unit>,
) {
    val gallery = condition.gallery
    SearchWithFilter(
        value = searchText,
        onValue = { onSearchText(it); events.search(it) },
        placeholder = stringResource(R.string.gallery_search_placeholder),
        activeFilter = FilterCount.gallery(condition.glance.householdMembers, condition.accountChoice(), condition.storage.locations,
            condition.storageChoice(), gallery.galleryTheme),
        onFilter = onFilter,
        // At normal size the FAB itself offers scanning (next to manual entry); with large
        // text there's no FAB (record sits here instead), so scanning stays next to it.
        scanOn = onScanBarcode.takeIf { largeFont() },
        record = record,
        active = listOfNotNull(
            accountFilter(condition.glance.householdMembers, condition.accountChoice()) { events.account(ScopeFilter.ALL) },
            storageFilter(condition.storage.locations, condition.storageChoice()) { events.storageLocation("") },
            gallery.galleryTheme.takeIf { it.isNotBlank() }?.let { ActiveFilter(it) { events.theme("") } },
        ),
        sorting = {
            SortMenu(
                options = SetSort.entries.map { it to it.label() },
                chosen = gallery.gallerySort, onChoice = events.sorting,
                default = SetSort.DEFAULT,
            )
        },
    )
}

/** What sits below the search: skeleton, error, empty collection, no hits, or the grid. */
@Composable
private fun GalleryContent(
    display: GalleryDisplay,
    condition: GalleryState,
    searchText: String,
    onRefresh: () -> Unit,
    empty: @Composable () -> Unit,
    list: @Composable () -> Unit,
) {
    val gallery = condition.gallery
    val stats = gallery.stats
    when (display) {
        GalleryDisplay.LOADS -> SkeletonRaster(ReadableColumns(160.dp), tileHeight = 252.dp,
            headerRow = true, imageRatio = IMAGE_ASPECT_RATIO)
        // Error and empty collection look different and offer
        // different things: here the reason and a retry.
        GalleryDisplay.ERROR -> GalleryHint {
            ErrorHint(gallery.fetch.errorMessage?.sentence(), onRefresh,
                gallery.fetch.errorKind)
        }
        GalleryDisplay.EMPTY -> empty()
        GalleryDisplay.NO_HITS -> GalleryHint {
            // The figures refer to the whole collection — even with no hits.
            if (stats != null) GalleryMetrics(stats)
            EmptySymbol(Icons.Default.SearchOff)
            Text(stringResource(R.string.gallery_no_results, searchText), fontWeight = FontWeight.SemiBold)
        }
        GalleryDisplay.LIST -> list()
    }
}

/** The empty collection: add and scan, the same dialog as the plus button. */
@Composable
private fun GalleryEmpty(addOn: () -> Unit, onScanBarcode: () -> Unit) {
    GalleryHint {
        Image(painterResource(R.drawable.ic_logo), null, Modifier.size(64.dp))
        Text(stringResource(R.string.gallery_no_sets), fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.gallery_empty_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center)
        // The same dialog as the plus button — no second entry path.
        ButtonStack {
            Button(onClick = addOn, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
                Spacer(Modifier.width(Spacing.small))
                Text(stringResource(R.string.gallery_add_first))
            }
            OutlinedButton(onClick = onScanBarcode, modifier = Modifier.fillMaxWidth(), colors = secondaryButtonColors(), border = secondaryButtonRand()) {
                Icon(BarcodeSymbol, null, Modifier.size(withFont(18.dp)))
                Spacer(Modifier.width(Spacing.small))
                Text(stringResource(R.string.gallery_scan_barcode))
            }
        }
    }
}

/** Figures and tiles; the set whose detail is open next to it is marked. */
@Composable
private fun GalleryRaster(
    condition: GalleryState,
    imageLoader: ImageLoader,
    gridState: LazyGridState,
    onSetClick: (String) -> Unit,
) {
    val gallery = condition.gallery
    val stats = gallery.stats
    val chosen = LocalOpenDetail.current
    val columns = ReadableColumns(160.dp)
    // List rows as soon as only one column fits or the font is large: at 130%
    // a tile otherwise stood across the full width, the image took two thirds of the height
    // and one set filled the screen.
    BoxWithConstraints {
    val density = LocalDensity.current
    val singleColumn = with(columns) { density.count(maxWidth - Spacing.medium * 2, Spacing.small) } <= 1
    val row = largeFont() || singleColumn
    LazyVerticalGrid(
        columns = columns,
        state = gridState,
        contentPadding = PaddingValues(start = Spacing.medium, top = Spacing.medium, end = Spacing.medium,
            bottom = FabSpace),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        verticalArrangement = Arrangement.spacedBy(Spacing.small)
    ) {
        if (stats != null) {
            item(key = "gallery-stats", span = { GridItemSpan(maxLineSpan) }) {
                GalleryMetrics(stats)
            }
        }
        itemsIndexed(gallery.sets, key = { _, s -> s.setNumber }) { index, set ->
            Moved {
                SetCard(set, condition.app.serverUrl, imageLoader, onSetClick, index,
                    price = condition.prices[set.setNumber], currency = condition.app.currency,
                    picked = set.setNumber == chosen, row = row)
            }
        }
    }
    }
}

/** The collection's figures — the grid's first row, it scrolls with it. */
@Composable
private fun GalleryMetrics(stats: MetricsView) {
    MetricsSeries {
        GalleryStatChip(stats.totalSets, R.plurals.gallery_stat_sets)
        GalleryStatChip(stats.totalQuantity, R.plurals.gallery_stat_units)
        GalleryStatChip(stats.totalParts, R.plurals.gallery_stat_parts,
            partsBreakdown(stats.partsFromSets, stats.partsSingle))
        // Always all figures, even at 0: a row whose chips come and go depending on the
        // inventory doesn't read consistently; 0 figures is information too.
        GalleryStatChip(stats.totalMinifigs, R.plurals.gallery_stat_minifigs)
        GalleryStatChip(stats.totalInstructions, R.plurals.gallery_stat_instructions)
    }
}

/**
 * Centered, scrollable and with a margin: the content must be fully
 * reachable in landscape too, and PullToRefreshBox needs a scrollable child so
 * pulling to refresh keeps working.
 */
@Composable
private fun GalleryHint(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.huge),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.small, Alignment.CenterVertically),
        content = content,
    )
}

/** Label of a sort order; spelled out so a new value here stands out. */
@Composable
internal fun SetSort.label(): String = stringResource(when (this) {
    SetSort.NEWEST -> R.string.gallery_sort_added_desc
    SetSort.OLDEST -> R.string.gallery_sort_added_asc
    SetSort.NAME -> R.string.gallery_sort_name
    SetSort.NUMBER -> R.string.gallery_sort_number
    SetSort.YEAR -> R.string.gallery_sort_year_desc
    SetSort.PRICE_DESCENDING -> R.string.gallery_sort_price_desc
    SetSort.PRICE_ASCENDING -> R.string.gallery_sort_price_asc
    SetSort.QUANTITY_DESCENDING -> R.string.gallery_sort_qty_desc
    SetSort.QUANTITY_ASCENDING -> R.string.gallery_sort_qty_asc
})

/** The same labels for the watchlist; without a quantity there. */
@Composable
internal fun WantedSort.label(): String = stringResource(when (this) {
    WantedSort.NEWEST -> R.string.gallery_sort_added_desc
    WantedSort.OLDEST -> R.string.gallery_sort_added_asc
    WantedSort.NAME -> R.string.gallery_sort_name
    WantedSort.NUMBER -> R.string.gallery_sort_number
    WantedSort.YEAR -> R.string.gallery_sort_year_desc
    WantedSort.PRICE_DESCENDING -> R.string.gallery_sort_price_desc
    WantedSort.PRICE_ASCENDING -> R.string.gallery_sort_price_asc
})
