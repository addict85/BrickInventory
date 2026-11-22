package ch.brickinventoryapp.catalog.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.catalog.ui.CatalogTarget
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import coil3.ImageLoader

/**
 * Catalog screen: the whole Rebrickable set catalog, paginated server-side.
 * Built like GalleryScreen (search on top, filter chips, grid) — but filters
 * run server-side, the grid fetches pages as it scrolls.
 */
@Composable
internal fun CatalogRoute(
    catalog: CatalogViewModel,
    serverUrl: String,
    imageLoader: ImageLoader,
    scrollMemory: ScrollMemory,
    onSetClick: (String) -> Unit,
) {
    val state by catalog.state.collectAsStateWithLifecycle()
    CatalogScreen(state, serverUrl, catalog, imageLoader, onSetClick, scrollMemory)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    state: CatalogUiState,
    serverUrl: String,
    catalog: CatalogActions,
    imageLoader: ImageLoader,
    /** Clicking a set — only the graph knows the NavController. */
    onSetClick: (String) -> Unit,
    /** The one source of the scroll position, the same as for the other tabs. */
    scrollMemory: ScrollMemory = remember { ScrollMemory() },
) {
    val onQueryChange: (String) -> Unit = { q -> catalog.setCatalogQuery(q) }
    val onThemeChange: (Int?) -> Unit = { t -> catalog.setCatalogTheme(t) }
    val onYearChange: (Int?) -> Unit = { y -> catalog.setCatalogYear(y) }
    val onSortChange: (CatalogSort) -> Unit = { srt -> catalog.setCatalogSort(srt) }
    /** Report the visible window; the ViewModel loads once the list is still. */
    val onVisible: (Int, Int) -> Unit = { of, until -> catalog.catalogVisible(of, until) }
    /** The bar on the right scrolls the list to a spot — without filtering. */
    val onScrollTo: (Int) -> Unit = { number -> catalog.scrollCatalogTo(number) }
    /** Reports that the jump was carried out. */
    val onScrollConsumed: () -> Unit = { catalog.catalogScrollConsumed() }
    val onRefresh: () -> Unit = { catalog.loadCatalogMeta(); catalog.loadCatalogSets() }

    // As state objects instead of via `by`: CatalogFilterRow() sets them and needs
    // the same object, not a copy.
    val showThemeSheet = remember { mutableStateOf(false) }
    val showYearSheet  = remember { mutableStateOf(false) }

    // One state per visit; ScrollMemory holds the position. The slots count via
    // `total`, so the list is ready as soon as the length is there.
    val gridState = remember { LazyGridState() }
    ScrollPositionKeeper(CatalogTarget.Catalog.rollKey, gridState, ready = state.total > 0, memory = scrollMemory)

    // The list keeps all `total` slots; the page of a slot that becomes visible is loaded,
    // with one page of lead — so the bar on the right can jump anywhere.
    LaunchedEffect(gridState, state.total, state.loadedPages.size) {
        snapshotFlow {
            val visible = gridState.layoutInfo.visibleItemsInfo
            val firstPage = ((visible.firstOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            val lastPage = ((visible.lastOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            firstPage to lastPage
        }.collect { (of, until) -> onVisible(of, until) }
    }

    // No separate jump fetch next to it: both paths — scrolling and the bar — end in the
    // viewport loader above, and its quiet period covers both. Two versions
    // of the same rule drifted apart.

    // The bar's handle hangs on the list position like a scrollbar, as
    // in the web app: gridState.firstVisibleItemIndex is the position, its year comes from
    // the distribution (CatalogYearMath).

    // Carry out the scrubber's jump target.
    LaunchedEffect(state.scrollTo) {
        state.scrollTo?.let { target ->
            gridState.scrollToItem(target.coerceIn(0, (state.total - 1).coerceAtLeast(0)))
            onScrollConsumed()
        }
    }

    val selectedThemeName = state.themes.firstOrNull { it.id == state.themeId }?.name
        ?.substringAfterLast(" › ")

    // Space on the right only if the year bar sits there; otherwise the same margins on both sides.
    val withYearsBar = state.sort.afterYear && state.yearDistribution.isNotEmpty()
    val rasterEdge = PaddingValues(start = Spacing.medium, top = Spacing.medium, bottom = Spacing.medium,
        end = if (withYearsBar) TRACK_WIDTH else Spacing.medium)
    val filtered = state.query.isNotBlank() || state.themeId != null || state.year != null
    val error = state.fetch as? Load.Failure
    val loading = state.fetch.loading
    Column(Modifier.fillMaxSize()) {
        CatalogSearchField(state, onQueryChange, onSortChange)
        CatalogFilterRow(state, selectedThemeName, showThemeSheet, showYearSheet)
        // Hit count — not on error: "0 sets in catalog" used to sit there next to the error.
        if (error == null || state.total > 0) Text(
            // pluralStringResource instead of stringResource: "1 set in catalog",
            // not "1 sets".
            pluralStringResource(R.plurals.catalog_result_count, state.total, state.total),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Spacing.large, vertical = Spacing.hairline)
        )

        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = loading && state.total > 0,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize()
        ) {
            when {
                // The same dimensions as the grid below it, so nothing jumps on arrival.
                loading && state.total == 0 -> SkeletonRaster(
                    ReadableColumns(160.dp), tileHeight = 200.dp, padding = rasterEdge,
                )
                // The same error state as gallery, parts and watchlist.
                error != null && state.total == 0 -> StateHint {
                    ErrorHint(error.message.sentence(), onRefresh, error.kind)
                }
                // With search or filter: say why, and offer a way back.
                state.total == 0 && filtered -> StateHint {
                    NoHitsHint(stringResource(R.string.catalog_no_results))
                    Button(onClick = {
                        if (state.query.isNotBlank()) onQueryChange("")
                        if (state.themeId != null) onThemeChange(null)
                        if (state.year != null) onYearChange(null)
                    }) { Text(stringResource(R.string.filter_reset_all)) }
                }
                state.total == 0 -> StateHint {
                    HintText(Icons.AutoMirrored.Filled.MenuBook, stringResource(R.string.catalog_empty_title),
                        stringResource(R.string.catalog_empty_text))
                    Button(onClick = onRefresh) { Text(stringResource(R.string.common_retry)) }
                }
                else -> Box(Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = ReadableColumns(160.dp),
                        contentPadding = rasterEdge,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                        verticalArrangement = Arrangement.spacedBy(Spacing.small)
                    ) {
                        // One slot per set across the whole result — including what's
                        // not yet loaded. The key is the
                        // position, not the set number: a placeholder has
                        // none yet.
                        items(count = state.total, key = { it }) { index ->
                            val page = index / CATALOG_PAGE_SIZE + 1
                            val set = state.loadedPages[page]?.getOrNull(index % CATALOG_PAGE_SIZE)
                            if (set != null) CatalogSetCard(set, imageLoader, serverUrl, onSetClick, index)
                            else CatalogPlaceholderCard()
                        }
                    }
                    // The year bar is fast scroll, not a filter: dragging scrolls the list,
                    // the label shows the position's year. Only when sorted by year, as in
                    // the web app — otherwise the years are scattered. firstVisibleItemIndex read in
                    // derivedStateOf, so the screen only re-evaluates on a change of the
                    // derived value (Lint FrequentlyChangingValue).
                    val visibleNumber by remember(gridState) {
                        derivedStateOf { gridState.firstVisibleItemIndex }
                    }
                    if (withYearsBar && state.total > 0) {
                        YearScrubber(
                            listNumber = visibleNumber,
                            total = state.total,
                            distribution = state.yearDistribution,
                            // First choice as in the web app: the year of the
                            // tile that sits at this position. This exact
                            // calculation used to sit further up in the screen
                            // and was called `sichtbaresJahr`.
                            yearLoaded = { number ->
                                state.loadedPages[number / CATALOG_PAGE_SIZE + 1]
                                    ?.getOrNull(number % CATALOG_PAGE_SIZE)?.year
                            },
                            // Only SCROLL, don't load: what's needed at the new position
                            // is fetched by the viewport loader —
                            // debounced, see above. A fetch at this spot
                            // would run on EVERY touch point.
                            onScrollTo = onScrollTo,
                            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight()
                        )
                    }
                }
            }
        }
    }

    // ── Thema-Auswahl (BottomSheet: durchsuchbare Liste) ─────────────────────
    CatalogThemeSheet(state, showThemeSheet, onThemeChange)
    CatalogYearSheet(state, showYearSheet, onYearChange)
}

/** A row of the theme and year picker; public so the accessibility test can show it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThemeRow(label: String, selected: Boolean, onClick: () -> Unit) {
    // A radio button: TalkBack names role and choice, the checkmark alone only saw those who could see.
    Surface(
        selected = selected,
        onClick = onClick,
        shape = Shapes.tile,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                else androidx.compose.ui.graphics.Color.Transparent,
        modifier = Modifier.fillMaxWidth().focusFrame(Shapes.tile).semantics { role = Role.RadioButton }
    ) {
        Row(
            Modifier.padding(horizontal = Spacing.medium, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
/** Label for a sort order; spelled out so a new value here stands out. */
internal fun CatalogSort.label(): String = stringResource(when (this) {
    CatalogSort.YEAR_DESCENDING -> R.string.catalog_sort_year_desc
    CatalogSort.YEAR_ASCENDING -> R.string.catalog_sort_year_asc
    CatalogSort.NAME -> R.string.catalog_sort_name
    CatalogSort.NUMBER -> R.string.catalog_sort_number
    CatalogSort.PARTS_DESCENDING -> R.string.catalog_sort_parts_desc
    CatalogSort.PARTS_ASCENDING -> R.string.catalog_sort_parts_asc
})
