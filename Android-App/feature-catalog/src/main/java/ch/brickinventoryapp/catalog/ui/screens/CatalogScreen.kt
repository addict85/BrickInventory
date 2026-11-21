package ch.brickinventoryapp.catalog.ui.screens

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.domain.Katalogsortierung
import androidx.compose.material.icons.automirrored.filled.MenuBook
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.StateHint
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.catalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import coil3.ImageLoader
import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.withFont

/**
 * Catalog screen: the whole Rebrickable set catalog, paginated server-side.
 * Built like GalleryScreen (search on top, filter chips, grid) — but filters
 * run server-side, the grid fetches pages as it scrolls.
 */
@Composable
internal fun CatalogRoute(
    katalog: CatalogViewModel,
    serverUrl: String,
    imageLoader: ImageLoader,
    rollgedaechtnis: ScrollMemory,
    onSetClick: (String) -> Unit,
) {
    val state by katalog.state.collectAsStateWithLifecycle()
    CatalogScreen(state, serverUrl, katalog, imageLoader, onSetClick, rollgedaechtnis)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    state: CatalogUiState,
    serverUrl: String,
    katalog: KatalogAktionen,
    imageLoader: ImageLoader,
    /** Clicking a set — only the graph knows the NavController. */
    onSetClick: (String) -> Unit,
    /** The one source of the scroll position, the same as for the other tabs. */
    rollgedaechtnis: ScrollMemory = remember { ScrollMemory() },
) {
    val onQueryChange: (String) -> Unit = { q -> katalog.setCatalogQuery(q) }
    val onThemeChange: (Int?) -> Unit = { t -> katalog.setCatalogTheme(t) }
    val onYearChange: (Int?) -> Unit = { y -> katalog.setCatalogYear(y) }
    val onSortChange: (Katalogsortierung) -> Unit = { srt -> katalog.setCatalogSort(srt) }
    /** Report the visible window; the ViewModel loads once the list is still. */
    val onVisible: (Int, Int) -> Unit = { von, bis -> katalog.catalogVisible(von, bis) }
    /** The bar on the right scrolls the list to a spot — without filtering. */
    val onScrollTo: (Int) -> Unit = { nummer -> katalog.scrollCatalogTo(nummer) }
    /** Reports that the jump was carried out. */
    val onScrollConsumed: () -> Unit = { katalog.catalogScrollConsumed() }
    val onRefresh: () -> Unit = { katalog.loadCatalogMeta(); katalog.loadCatalogSets() }

    // As state objects instead of via `by`: CatalogFilterRow() sets them and needs
    // the same object, not a copy.
    val showThemeSheet = remember { mutableStateOf(false) }
    val showYearSheet  = remember { mutableStateOf(false) }

    // One state per visit; ScrollMemory holds the position. The slots count via
    // `total`, so the list is ready as soon as the length is there.
    val gridState = remember { LazyGridState() }
    ScrollPositionKeeper(KatalogZiel.Catalog.rollSchluessel, gridState, bereit = state.total > 0, speicher = rollgedaechtnis)

    // The list keeps all `total` slots; the page of a slot that becomes visible is loaded,
    // with one page of lead — so the bar on the right can jump anywhere.
    LaunchedEffect(gridState, state.total, state.loadedPages.size) {
        snapshotFlow {
            val sichtbar = gridState.layoutInfo.visibleItemsInfo
            val firstPage = ((sichtbar.firstOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            val lastPage = ((sichtbar.lastOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            firstPage to lastPage
        }.collect { (von, bis) -> onVisible(von, bis) }
    }

    // No separate jump fetch next to it: both paths — scrolling and the bar — end in the
    // viewport loader above, and its quiet period covers both. Two versions
    // of the same rule drifted apart.

    // The bar's handle hangs on the list position like a scrollbar, as
    // in the web app: gridState.firstVisibleItemIndex is the position, its year comes from
    // the distribution (CatalogYearMath).

    // Carry out the scrubber's jump target.
    LaunchedEffect(state.scrollTo) {
        state.scrollTo?.let { ziel ->
            gridState.scrollToItem(ziel.coerceIn(0, (state.total - 1).coerceAtLeast(0)))
            onScrollConsumed()
        }
    }

    val selectedThemeName = state.themes.firstOrNull { it.id == state.themeId }?.name
        ?.substringAfterLast(" › ")

    // Space on the right only if the year bar sits there; otherwise the same margins on both sides.
    val withYearsBar = state.sort.afterYear && state.yearDistribution.isNotEmpty()
    val rasterEdge = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel, bottom = Abstaende.mittel,
        end = if (withYearsBar) TRACK_WIDTH else Abstaende.mittel)
    val gefiltert = state.query.isNotBlank() || state.themeId != null || state.year != null
    val fehler = state.abruf as? Laden.Fehler
    val laedt = state.abruf.laedt
    Column(Modifier.fillMaxSize()) {
        CatalogSearchField(state, onQueryChange, onSortChange)
        CatalogFilterRow(state, selectedThemeName, showThemeSheet, showYearSheet)
        // Hit count — not on error: "0 sets in catalog" used to sit there next to the error.
        if (fehler == null || state.total > 0) Text(
            // pluralStringResource instead of stringResource: "1 set in catalog",
            // not "1 sets".
            pluralStringResource(R.plurals.catalog_result_count, state.total, state.total),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.hairline)
        )

        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = laedt && state.total > 0,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize()
        ) {
            when {
                // The same dimensions as the grid below it, so nothing jumps on arrival.
                laedt && state.total == 0 -> SkeletonRaster(
                    ReadableColumns(160.dp), kachelHoehe = 200.dp, innenabstand = rasterEdge,
                )
                // The same error state as gallery, parts and watchlist.
                fehler != null && state.total == 0 -> StateHint {
                    ErrorHint(fehler.meldung.satz(), onRefresh, fehler.art)
                }
                // With search or filter: say why, and offer a way back.
                state.total == 0 && gefiltert -> StateHint {
                    NoHitsHint(stringResource(R.string.catalog_no_results))
                    Button(onClick = {
                        if (state.query.isNotBlank()) onQueryChange("")
                        if (state.themeId != null) onThemeChange(null)
                        if (state.year != null) onYearChange(null)
                    }) { Text(stringResource(R.string.filter_reset_all)) }
                }
                state.total == 0 -> StateHint {
                    HintText(Icons.AutoMirrored.Filled.MenuBook, stringResource(R.string.catalog_leer_titel),
                        stringResource(R.string.catalog_leer_text))
                    Button(onClick = onRefresh) { Text(stringResource(R.string.common_retry)) }
                }
                else -> Box(Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = ReadableColumns(160.dp),
                        contentPadding = rasterEdge,
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
                    ) {
                        // One slot per set across the whole result — including what's
                        // not yet loaded. The key is the
                        // position, not the set number: a placeholder has
                        // none yet.
                        items(count = state.total, key = { it }) { index ->
                            val seite = index / CATALOG_PAGE_SIZE + 1
                            val set = state.loadedPages[seite]?.getOrNull(index % CATALOG_PAGE_SIZE)
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
                            listenNummer = visibleNumber,
                            total = state.total,
                            verteilung = state.yearDistribution,
                            // First choice as in the web app: the year of the
                            // tile that sits at this position. This exact
                            // calculation used to sit further up in the screen
                            // and was called `sichtbaresJahr`.
                            jahrGeladen = { nummer ->
                                state.loadedPages[nummer / CATALOG_PAGE_SIZE + 1]
                                    ?.getOrNull(nummer % CATALOG_PAGE_SIZE)?.year
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
        shape = Formen.kachel,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                else androidx.compose.ui.graphics.Color.Transparent,
        modifier = Modifier.fillMaxWidth().focusFrame(Formen.kachel).semantics { role = Role.RadioButton }
    ) {
        Row(
            Modifier.padding(horizontal = Abstaende.mittel, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
/** Label for a sort order; spelled out so a new value here stands out. */
internal fun Katalogsortierung.beschriftung(): String = stringResource(when (this) {
    Katalogsortierung.JAHR_ABSTEIGEND -> R.string.catalog_sort_year_desc
    Katalogsortierung.JAHR_AUFSTEIGEND -> R.string.catalog_sort_year_asc
    Katalogsortierung.NAME -> R.string.catalog_sort_name
    Katalogsortierung.NUMMER -> R.string.catalog_sort_number
    Katalogsortierung.TEILE_ABSTEIGEND -> R.string.catalog_sort_parts_desc
    Katalogsortierung.TEILE_AUFSTEIGEND -> R.string.catalog_sort_parts_asc
})
