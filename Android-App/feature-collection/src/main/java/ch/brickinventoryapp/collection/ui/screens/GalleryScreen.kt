package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.domain.MetricsView
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.GalleryDisplay
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.galleryDisplay
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.Filterzahl
import ch.brickinventoryapp.state.ui.LagerUiState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.EmptySymbol
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.SortierMenu
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.BarcodeSymbol
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.ButtonStack
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.SearchWithFilter
import ch.brickinventoryapp.shared.ui.ActiveFilter
import ch.brickinventoryapp.shared.ui.accountFilter
import ch.brickinventoryapp.shared.ui.storageFilter
import ch.brickinventoryapp.shared.ui.partsBreakdown
import ch.brickinventoryapp.collection.ui.TilePrice

/** What the gallery shows; the route gathers it from the ViewModels' flows. */
internal data class GalleryState(
    val app: AppUiState,
    val blick: ScopeUiState,
    val galerie: GalleryUiState,
    val preise: Map<String, TilePrice>,
    val barcode: BarcodeUiState,
    val lager: LagerUiState,
)

/** What the gallery triggers; the route wires it to GalleryViewModel and EntryViewModel. */
internal class GalleryEvents(
    val suche: (String) -> Unit,
    val thema: (String) -> Unit,
    val sorting: (Setsortierung) -> Unit,
    val konto: (String) -> Unit,
    val lagerort: (String) -> Unit,
    val aktualisieren: () -> Unit,
    val setErfassen: (Erfassungswunsch) -> Unit,
    val manualEntryAcknowledged: () -> Unit,
)

/**
 * "deleted" with "Undo". Only deleted once the snackbar ends without Undo —
 * even if it disappears because you leave the gallery. Every snackbar
 * answers only for its own set: if a second delete replaces it, its Undo remains.
 */
@Composable
internal fun GalleryUndoRoute(vm: GalleryViewModel, snackbarHostState: SnackbarHostState) {
    val vorgemerkt by vm.vorgemerkt.collectAsStateWithLifecycle()
    val text = vorgemerkt?.let { stringResource(R.string.vm_set_deleted, it.name) }
    val rueckgaengig = stringResource(R.string.common_undo)
    LaunchedEffect(vorgemerkt) {
        val v = vorgemerkt ?: return@LaunchedEffect
        var zurueck = false
        try {
            zurueck = snackbarHostState.showSnackbar(text ?: v.name, rueckgaengig,
                duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed
        } finally {
            if (zurueck) vm.rueckgaengig(v) else vm.executeDelete(v)
        }
    }
}

/** The gallery at the navigation destination: gathers the flows and passes state and events on. */
@Composable
fun GalleryRoute(
    vm: GalleryViewModel,
    /** This destination's entry flow; the graph binds it to its entry. */
    erfassung: EntryViewModel,
    imageLoader: ImageLoader,
    /** Open the barcode scanner — only the graph knows the NavController. */
    onScanBarcode: () -> Unit,
    /** Clicking a set, likewise. */
    onSetClick: (String) -> Unit,
    /** Scroll state from outside, so it survives the trip to the detail view. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    // Its own flow for the gallery: paging, searching and refetching only change
    // THIS state (see GalleryUiState).
    val galerie by vm.galleryState.collectAsStateWithLifecycle()
    val preise by vm.preise.collectAsStateWithLifecycle()
    val barcodeState by erfassung.barcodeState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    val events = remember(vm, erfassung) {
        GalleryEvents(
            suche = vm::setGalleryQuery,
            thema = vm::setGalleryTheme,
            sorting = vm::setGallerySort,
            konto = { vm.setScope(ScopeFilter.View.GALLERY, it) },
            lagerort = { vm.setStorageFilter(ScopeFilter.View.GALLERY, it) },
            // The filter lists too: otherwise they'd only load on start.
            aktualisieren = vm::aktualisieren,
            setErfassen = erfassung::addSet,
            manualEntryAcknowledged = { erfassung.manuelleErfassungQuittieren() },
        )
    }
    GalleryScreen(
        zustand = GalleryState(state, blick, galerie, preise, barcodeState, storageState),
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
    zustand: GalleryState,
    events: GalleryEvents,
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    onSetClick: (String) -> Unit,
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val galerie = zustand.galerie
    var showAddDialog by rememberSaveable { mutableStateOf(false) }

    // ── An unsuccessful scan opens manual entry ──
    //
    // The unsuccessful paths (EAN not resolvable, no set number, text recognition with no
    // hit) report via a field in the state; collected and acknowledged here,
    // otherwise the dialog would open again on the next recomposition.
    LaunchedEffect(zustand.barcode.manuelleErfassungAnfordern) {
        if (zustand.barcode.manuelleErfassungAnfordern) {
            showAddDialog = true
            events.manualEntryAcknowledged()
        }
    }
    // The input field holds its own text (typing stays smooth); the
    // debouncing and the fetch live in the ViewModel, because the
    // filter generation also lives there. If the value changes from outside (sign-in,
    // reset), the field follows.
    var searchInput by remember(galerie.galleryQuery) { mutableStateOf(galerie.galleryQuery) }
    var showFilter by rememberSaveable { mutableStateOf(false) }

    // No local filtering and no theme list from `sets`: the screen shows what the
    // server delivered — a second search here would know neither year nor sorting,
    // and the themes would come from the loaded page instead of the whole inventory.

    val anzeige = galleryDisplay(galerie, gefiltert = searchInput.isNotBlank() || galerie.galleryTheme.isNotEmpty())
    // From large font size on, Add sits in the button row below the search (SearchWithFilter).
    val gross = largeFont()
    val addText = stringResource(R.string.gallery_add_set)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Search and one button for everything else: account, storage location, theme and
            // sorting live in the sheet; the figures scroll with the grid. Scanning
            // sits next to it, so only ONE button floats at the bottom. Not in the error state:
            // without a collection there's nothing to search.
            if (anzeige != GalleryDisplay.FEHLER && anzeige != GalleryDisplay.LEER) GallerySearch(
                zustand, events, searchInput, { searchInput = it }, onScanBarcode,
                onFilter = { showFilter = true }, erfassen = addText to { showAddDialog = true },
            )

            OfflineHint(galerie.offlineStatus, onErneut = events.aktualisieren)
            // The drag spinner only over a list: on the first load the
            // skeleton already shows that something is coming, two loading indicators stacked felt restless.
            PullToRefreshBox(isRefreshing = galerie.abruf.laedt && anzeige == GalleryDisplay.LISTE,
                             onRefresh = events.aktualisieren, modifier = Modifier.fillMaxSize()) {
                GalleryContent(anzeige, zustand, searchInput, imageLoader, gridState, onSetClick,
                    onScanBarcode, addOn = { showAddDialog = true }, onRefresh = events.aktualisieren)
            }
        }

        // Add only once the collection is there: in the error state, attention belongs to the
        // reason and "Try again", not a button that would go nowhere.
        // Not empty either: the empty message itself offers Add and Scan.
        if (!gross && anzeige != GalleryDisplay.FEHLER && anzeige != GalleryDisplay.LEER) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (showFilter) GalerieFilter(zustand, events, onSchliessen = { showFilter = false })
    if (showAddDialog) GalerieErfassen(zustand, events, onSchliessen = { showAddDialog = false })
}

/** The gallery's account scope and chosen storage location. */
internal fun GalleryState.accountChoice(): String =
    blick.scopeModes[ScopeFilter.View.GALLERY] ?: ScopeFilter.ALL

internal fun GalleryState.storageChoice(): String =
    lager.modi[ScopeFilter.View.GALLERY] ?: ""

/** Search, filter button, scan and sort above the grid. */
@Composable
private fun GallerySearch(
    zustand: GalleryState,
    events: GalleryEvents,
    suchtext: String,
    onSearchText: (String) -> Unit,
    onScanBarcode: () -> Unit,
    onFilter: () -> Unit,
    erfassen: Pair<String, () -> Unit>,
) {
    val galerie = zustand.galerie
    SearchWithFilter(
        wert = suchtext,
        onValue = { onSearchText(it); events.suche(it) },
        platzhalter = stringResource(R.string.gallery_search_placeholder),
        activeFilter = Filterzahl.galerie(zustand.blick.householdMembers, zustand.accountChoice(), zustand.lager.orte,
            zustand.storageChoice(), galerie.galleryTheme),
        onFilter = onFilter,
        scanOn = onScanBarcode,
        erfassen = erfassen,
        aktive = listOfNotNull(
            accountFilter(zustand.blick.householdMembers, zustand.accountChoice()) { events.konto(ScopeFilter.ALL) },
            storageFilter(zustand.lager.orte, zustand.storageChoice()) { events.lagerort("") },
            galerie.galleryTheme.takeIf { it.isNotBlank() }?.let { ActiveFilter(it) { events.thema("") } },
        ),
        sorting = {
            SortierMenu(
                optionen = Setsortierung.entries.map { it to it.beschriftung() },
                gewaehlt = galerie.gallerySort, onWahl = events.sorting,
                vorgabe = Setsortierung.DEFAULT,
            )
        },
    )
}

/** What sits below the search: skeleton, error, empty collection, no hits, or the grid. */
@Composable
private fun GalleryContent(
    anzeige: GalleryDisplay,
    zustand: GalleryState,
    suchtext: String,
    imageLoader: ImageLoader,
    gridState: LazyGridState,
    onSetClick: (String) -> Unit,
    onScanBarcode: () -> Unit,
    addOn: () -> Unit,
    onRefresh: () -> Unit,
) {
    val galerie = zustand.galerie
    val stats = galerie.stats
    when (anzeige) {
        GalleryDisplay.LOADS -> SkeletonRaster(ReadableColumns(160.dp), kachelHoehe = 252.dp,
            headerRow = true, imageRatio = IMAGE_ASPECT_RATIO)
        // Error and empty collection look different and offer
        // different things: here the reason and a retry.
        GalleryDisplay.FEHLER -> GalleryHint {
            ErrorHint(galerie.abruf.errorMessage?.satz(), onRefresh,
                galerie.abruf.errorKind)
        }
        GalleryDisplay.LEER -> GalleryEmpty(addOn, onScanBarcode)
        GalleryDisplay.NO_HITS -> GalleryHint {
            // The figures refer to the whole collection — even with no hits.
            if (stats != null) GalleryMetrics(stats)
            EmptySymbol(Icons.Default.SearchOff)
            Text(stringResource(R.string.gallery_no_results, suchtext), fontWeight = FontWeight.SemiBold)
        }
        GalleryDisplay.LISTE -> GalleryRaster(zustand, imageLoader, gridState, onSetClick)
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
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.gallery_add_first))
            }
            OutlinedButton(onClick = onScanBarcode, modifier = Modifier.fillMaxWidth(), colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                Icon(BarcodeSymbol, null, Modifier.size(withFont(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.gallery_scan_barcode))
            }
        }
    }
}

/** Figures and tiles; the set whose detail is open next to it is marked. */
@Composable
private fun GalleryRaster(
    zustand: GalleryState,
    imageLoader: ImageLoader,
    gridState: LazyGridState,
    onSetClick: (String) -> Unit,
) {
    val galerie = zustand.galerie
    val stats = galerie.stats
    val gewaehlt = LocalOpenDetail.current
    val spalten = ReadableColumns(160.dp)
    // List rows as soon as only one column fits or the font is large: at 130%
    // a tile otherwise stood across the full width, the image took two thirds of the height
    // and one set filled the screen.
    BoxWithConstraints {
    val dichte = LocalDensity.current
    val singleColumn = with(spalten) { dichte.anzahl(maxWidth - Abstaende.mittel * 2, Abstaende.klein) } <= 1
    val zeile = largeFont() || singleColumn
    LazyVerticalGrid(
        columns = spalten,
        state = gridState,
        contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel, end = Abstaende.mittel,
            bottom = FabSpace),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
    ) {
        if (stats != null) {
            item(key = "gallery-stats", span = { GridItemSpan(maxLineSpan) }) {
                GalleryMetrics(stats)
            }
        }
        itemsIndexed(galerie.sets, key = { _, s -> s.setNumber }) { index, set ->
            Moved {
                SetCard(set, zustand.app.serverUrl, imageLoader, onSetClick, index,
                    preis = zustand.preise[set.setNumber], waehrung = zustand.app.currency,
                    ausgewaehlt = set.setNumber == gewaehlt, zeile = zeile)
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
private fun GalleryHint(inhalt: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Abstaende.huge),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein, Alignment.CenterVertically),
        content = inhalt,
    )
}

/** Label of a sort order; spelled out so a new value here stands out. */
@Composable
internal fun Setsortierung.beschriftung(): String = stringResource(when (this) {
    Setsortierung.NEUESTE -> R.string.gallery_sort_added_desc
    Setsortierung.AELTESTE -> R.string.gallery_sort_added_asc
    Setsortierung.NAME -> R.string.gallery_sort_name
    Setsortierung.NUMMER -> R.string.gallery_sort_number
    Setsortierung.JAHR -> R.string.gallery_sort_year_desc
    Setsortierung.PREIS_ABSTEIGEND -> R.string.gallery_sort_price_desc
    Setsortierung.PREIS_AUFSTEIGEND -> R.string.gallery_sort_price_asc
    Setsortierung.MENGE_ABSTEIGEND -> R.string.gallery_sort_qty_desc
    Setsortierung.MENGE_AUFSTEIGEND -> R.string.gallery_sort_qty_asc
})

/** The same labels for the watchlist; without a quantity there. */
@Composable
internal fun Merksortierung.beschriftung(): String = stringResource(when (this) {
    Merksortierung.NEUESTE -> R.string.gallery_sort_added_desc
    Merksortierung.AELTESTE -> R.string.gallery_sort_added_asc
    Merksortierung.NAME -> R.string.gallery_sort_name
    Merksortierung.NUMMER -> R.string.gallery_sort_number
    Merksortierung.JAHR -> R.string.gallery_sort_year_desc
    Merksortierung.PREIS_ABSTEIGEND -> R.string.gallery_sort_price_desc
    Merksortierung.PREIS_AUFSTEIGEND -> R.string.gallery_sort_price_asc
})
