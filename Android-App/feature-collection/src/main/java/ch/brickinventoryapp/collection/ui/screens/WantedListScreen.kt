package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material3.*
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.*
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.collection.ui.WantedItemDetailUiState
import ch.brickinventoryapp.collection.ui.WantedUiState
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListActions
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedSort
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.ScopeFilterRow
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.BarcodeSymbol
import ch.brickinventoryapp.ui.components.ButtonStack
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.LoadState
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.SearchField
import ch.brickinventoryapp.ui.components.SelectionChip
import ch.brickinventoryapp.ui.components.SortMenu
import ch.brickinventoryapp.ui.components.searchFieldWidth
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * A row's key: number, condition and account. The same set can stand new and
 * used and under two accounts; the number alone would lose Compose
 * the mapping.
 */
private fun wantedItemKey(w: WantedItemView) = "${w.setNumber}|${w.condition.identifier}|${w.userId}"

/** What the watchlist and watchlist-item detail show; the route gathers it from the flows. */
internal data class WantedListState(
    val appState: AppUiState,
    val glance: ScopeUiState,
    val list: WantedUiState,
    val detail: WantedItemDetailUiState,
    val storageUiState: StorageUiState,
)

/** Watchlist and detail at the navigation destination: one ViewModel for both halves. */
@Composable
fun WantedRoute(
    vm: WantedListViewModel,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOpenSingle: (String, Condition) -> Unit,
    sideBySide: Boolean = false,
    /** The account's list of all price alerts; null where there is no way there (tests). */
    onOpenPriceAlerts: (() -> Unit)? = null,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val list by vm.wantedState.collectAsStateWithLifecycle()
    val detail by vm.wantedItemDetailState.collectAsStateWithLifecycle()
    val storageUiState by vm.storageState.collectAsStateWithLifecycle()
    val view = WantedListState(appState, glance, list, detail, storageUiState)
    WantedAndDetail(view, vm, imageLoader, sideBySide, onScan, onOpenSingle, onOpenPriceAlerts)
}

/**
 * "removed from watchlist" with "Undo". Only deleted once the snackbar ends
 * without Undo — even if it disappears because you leave the watchlist.
 */
@Composable
fun WantedItemUndoRoute(vm: WantedListViewModel, snackbarHostState: SnackbarHostState) {
    val marked by vm.marked.collectAsStateWithLifecycle()
    val text = marked?.let { stringResource(R.string.wanted_deleted, it.name) }
    val undo = stringResource(R.string.common_undo)
    LaunchedEffect(marked) {
        val v = marked ?: return@LaunchedEffect
        var back = false
        try {
            back = snackbarHostState.showSnackbar(text ?: v.name, undo,
                duration = SnackbarDuration.Long) ==
                SnackbarResult.ActionPerformed
        } finally {
            if (back) vm.wantedItemUndo(v) else vm.executeWantedItemDelete(v)
        }
    }
}

/** The watchlist-item detail as its own page (phone). */
@Composable
internal fun WantedItemDetailRoute(
    vm: WantedListViewModel,
    setNumber: String,
    condition: Condition,
    imageLoader: coil3.ImageLoader,
    onBack: () -> Unit,
    onOpenPriceAlerts: (() -> Unit)? = null,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val list by vm.wantedState.collectAsStateWithLifecycle()
    val detail by remember(setNumber) { vm.wantedItemDetailOf(setNumber) }.collectAsStateWithLifecycle()
    val storageUiState by vm.storageState.collectAsStateWithLifecycle()
    val view = WantedListState(appState, glance, list, detail, storageUiState)
    WantedItemDetailScreen(view, vm, setNumber, condition, imageLoader, onBack, onOpenPriceAlerts)
}

/**
 * The watchlist — as a list, because it's read and worked through: number, year,
 * condition and price alert side by side, as in the web app. The rules live on the
 * server (`utils/merkliste.ts`); the screen shows and calls.
 */
@Composable
internal fun WantedListScreen(
    view: WantedListState,
    actions: WantedListActions,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOpen: (String, Condition) -> Unit,
    /** Set number and condition of the watchlist item whose detail is open next to it. */
    chosen: Pair<String, Condition>? = null,
) {
    val condition = view.list
    // The image addresses point to one's own server (proxy), not raw at the
    // CDN — the same rule as in gallery, parts and finances.
    val appState = view.appState
    val glance = view.glance

    // Taking it over goes through the detail (WantedItemDetailScreen), where quantity, purchase price
    // and condition are chosen; the row shows the market price for that.
    var openMask by rememberSaveable { mutableStateOf(false) }

    // ── The filter ──
    //
    // The same building blocks in the same order as in the gallery: account filter,
    // search field, chips. No storage-location filter — what you don't own sits nowhere; but
    // the condition, because the same set can stand new and used.
    val scopeMode = glance.scopeModes[ScopeFilter.View.WANTED_LIST]
        ?: ScopeFilter.ALL
    // The input field holds its own text (typing stays smooth); the
    // debouncing lives in the ViewModel. If the value changes from outside, the
    // field follows — the same line as in the gallery.
    var searchInput by remember(condition.query) { mutableStateOf(condition.query) }

    // Two empty messages: "No watchlist items yet" says something about the list,
    // "nothing found" about the filter; a load error a third.
    val filtered = condition.query.isNotBlank() ||
        condition.stateFilter != null ||
        scopeMode != ScopeFilter.ALL
    val error = condition.fetch.errorMessage?.sentence()
    val display = loadingIndicator(condition.wantedItem.isNotEmpty(), condition.fetch.loading, error, filtered)
    Box(Modifier.fillMaxSize()) {
        // Full width like every grid (ReadingWidth.kt): centered at 840 dp, the price stood
        // 1200 px from the title on the tablet; in the grid it stays next to it.
        Column(Modifier.fillMaxSize()) {
            ScopeFilterRow(
                members  = glance.householdMembers,
                current  = scopeMode,
                onSelect = { actions.setScope(ScopeFilter.View.WANTED_LIST, it) },
            )

            // Scan next to search as in the gallery: only ONE button floats at the bottom. In the
            // error state, neither search nor filter — there's nothing to search.
            // Without watchlist items, neither search nor filter: the empty message offers watchlisting and
            // scanning, a second scan button above would be the same path twice.
            val withHeader = display != LoadingIndicator.ERROR && display != LoadingIndicator.EMPTY
            if (withHeader) WantedSearchRow(searchInput, { searchInput = it; actions.setWantedSearch(it) },
                condition.sorting, actions, onScan)

            // The condition narrows the list: a filter, hence chips as in gallery and
            // finances; segments are only for views (sets | parts | minifigures).
            if (withHeader) StateFilterChips(
                chosen = condition.stateFilter,
                onChoice = { actions.setWantedState(it) },
                modifier = Modifier.padding(horizontal = Spacing.edge).padding(bottom = Spacing.small),
            )

            Column(Modifier.fillMaxSize().padding(horizontal = Spacing.edge)) {
                LoadState(
                    display = display,
                    error = error,
                    onAgain = { actions.loadWanted() },
                    // Like the empty gallery: say what the list is for, and offer both paths
                    // to the first entry — the same ones as the buttons at the bottom right.
                    empty = { WantedEmpty(onAdd = { openMask = true }, onScan) },
                    noHits = { NoHitsHint(stringResource(R.string.wanted_no_results)) },
                    errorClass = condition.fetch.errorKind,
                ) {
                    WantedGrid(condition.wantedItem, appState.serverUrl, imageLoader, chosen, onOpen)
                }
            }
        }

        // A button as in the gallery; scan sits next to search. Not in the error state,
        // and not empty either: there "Watchlist set" already sits in the middle of the image.
        if (display != LoadingIndicator.ERROR && display != LoadingIndicator.EMPTY) AddFab(
            stringResource(R.string.wanted_add_title), { openMask = true },
            Modifier.align(Alignment.BottomEnd).padding(Spacing.large),
        )
    }

    if (openMask) {
        WantedItemAddDialog(
            householdMembers = glance.householdMembers,
            defaultCondition = appState.userDefaultCondition ?: Condition.NEW,
            onDismiss = { openMask = false },
            createOn = { number, stateChoice, owner ->
                actions.createWantedItem(number, stateChoice, owner)
                openMask = false
            },
        )
    }
}

/**
 * The watchlist with the open item's detail next to it, when
 * [sideBySide] (wide window, listAndDetail()); otherwise [onOpenSingle] opens
 * the detail as its own page. One state for both halves: the same ViewModel.
 */
@Composable
internal fun WantedAndDetail(
    view: WantedListState,
    actions: WantedListActions,
    imageLoader: coil3.ImageLoader,
    sideBySide: Boolean,
    onScan: () -> Unit,
    onOpenSingle: (String, Condition) -> Unit,
    onOpenPriceAlerts: (() -> Unit)? = null,
) {
    var open by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val selection = open?.let { it[0] to (Condition.from(it[1]) ?: Condition.NEW) }
    val list: @Composable () -> Unit = {
        WantedListScreen(view = view, actions = actions, imageLoader = imageLoader, onScan = onScan,
            onOpen = { sn, z -> if (sideBySide) open = listOf(sn, z.identifier) else onOpenSingle(sn, z) },
            chosen = selection.takeIf { sideBySide })
    }
    if (sideBySide && selection != null) {
        ListAndDetail(
            list = list,
            detail = {
                // key: a different watchlist item is a different detail (dialogs, zoom close).
                androidx.compose.runtime.key(selection) {
                    val detail by remember { actions.wantedItemDetailOf(selection.first) }.collectAsStateWithLifecycle()
                    WantedItemDetailScreen(view = view.copy(detail = detail), actions = actions, setNumber = selection.first, condition = selection.second,
                        imageLoader = imageLoader, onBack = { open = null }, onOpenPriceAlerts = onOpenPriceAlerts)
                }
            },
        )
    } else list()
}

/** All | New | Used as filter chips; at large font size they wrap instead of being cut off. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StateFilterChips(chosen: Condition?, onChoice: (Condition?) -> Unit, modifier: Modifier = Modifier) {
    val options = listOf(null to R.string.filter_condition_all, Condition.NEW to R.string.condition_new,
        Condition.USED to R.string.condition_used)
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        options.forEach { (value, text) ->
            SelectionChip(selected = value == chosen, onClick = { onChoice(value) }, label = { Text(stringResource(text)) })
        }
    }
}

/** Search, sorting and scan above the list; scan sits next to search, so only ONE button floats at the bottom. */
@Composable
private fun WantedSearchRow(
    searchInput: String,
    onSearch: (String) -> Unit,
    sorting: WantedSort,
    actions: WantedListActions,
    onScan: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SearchField(
            value = searchInput,
            onValue = onSearch,
            placeholder = stringResource(R.string.wanted_search),
            modifier = Modifier.searchFieldWidth(this),
        )
        SortMenu(
            options = WantedSort.entries.map { it to it.label() },
            chosen = sorting,
            onChoice = { actions.setWantedSorting(it) },
            modifier = Modifier.padding(end = Spacing.tiny),
            default = WantedSort.DEFAULT,
        )
        ScanButton({ onScan() }, Modifier.padding(end = 14.dp))
    }
}

/**
 * Like the empty gallery: say what the list is for, and offer both paths
 * to the first entry — the same ones as the buttons at the bottom right.
 */
@Composable
private fun WantedEmpty(onAdd: () -> Unit, onScan: () -> Unit) {
    HintText(Icons.Default.BookmarkBorder, stringResource(R.string.wanted_empty),
        stringResource(R.string.wanted_empty_hint))
    ButtonStack {
        Button(onClick = onAdd, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.wanted_add_first))
        }
        OutlinedButton(onClick = { onScan() }, modifier = Modifier.fillMaxWidth(), colors = secondaryButtonColors(), border = secondaryButtonRand()) {
            Icon(BarcodeSymbol, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.gallery_scan_barcode))
        }
    }
}

/** The items as a grid; several columns from twice the column width on. */
@Composable
private fun WantedGrid(
    wanted: List<WantedItemView>,
    serverUrl: String,
    imageLoader: coil3.ImageLoader,
    chosen: Pair<String, Condition>?,
    onOpen: (String, Condition) -> Unit,
) {
    BoxWithConstraints {
        val multiColumn = maxWidth >= WANTED_COLUMN * 2
        LazyVerticalGrid(
            columns = GridCells.Adaptive(WANTED_COLUMN),
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(Spacing.small),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            // Room for the add button: without it, it would cover the last row.
            contentPadding = PaddingValues(bottom = FabSpace),
        ) {
            items(wanted, key = ::wantedItemKey) { w ->
                Moved {
                    WantedItemRow(w, serverUrl, imageLoader,
                        chosen = chosen == w.setNumber to w.condition,
                        onOpen = { onOpen(w.setNumber, w.condition) }, multiColumn = multiColumn)
                }
            }
        }
    }
}
