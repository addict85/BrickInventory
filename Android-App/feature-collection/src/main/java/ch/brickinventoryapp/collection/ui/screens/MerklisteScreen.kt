package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.LaunchedEffect
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.collection.ui.WantedItemDetailUiState
import ch.brickinventoryapp.collection.ui.WantedUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteAktionen
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.domain.WantedItemView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.items
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.LoadState
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.ui.satz
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.BarcodeSymbol
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.ButtonStack
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.AuswahlChip
import ch.brickinventoryapp.ui.components.SortierMenu
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.shared.ui.ScopeFilterRow
import ch.brickinventoryapp.ui.components.Suchfeld

/**
 * A row's key: number, condition and account. The same set can stand new and
 * used and under two accounts; the number alone would lose Compose
 * the mapping.
 */
private fun wantedItemKey(w: WantedItemView) = "${w.setNumber}|${w.condition.kennung}|${w.userId}"

/** What the watchlist and watchlist-item detail show; the route gathers it from the flows. */
internal data class MerklisteZustand(
    val appState: AppUiState,
    val blick: ScopeUiState,
    val liste: WantedUiState,
    val detail: WantedItemDetailUiState,
    val lagerZustand: LagerUiState,
)

/** Watchlist and detail at the navigation destination: one ViewModel for both halves. */
@Composable
fun WantedRoute(
    vm: MerklisteViewModel,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOpenSingle: (String, Zustand) -> Unit,
    sideBySide: Boolean = false,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val liste by vm.wantedState.collectAsStateWithLifecycle()
    val detail by vm.wantedItemDetailState.collectAsStateWithLifecycle()
    val lagerZustand by vm.storageState.collectAsStateWithLifecycle()
    val ansicht = MerklisteZustand(appState, blick, liste, detail, lagerZustand)
    WantedAndDetail(ansicht, vm, imageLoader, sideBySide, onScan, onOpenSingle)
}

/**
 * "removed from watchlist" with "Undo". Only deleted once the snackbar ends
 * without Undo — even if it disappears because you leave the watchlist.
 */
@Composable
fun WantedItemUndoRoute(vm: MerklisteViewModel, snackbarHostState: SnackbarHostState) {
    val vorgemerkt by vm.vorgemerkt.collectAsStateWithLifecycle()
    val text = vorgemerkt?.let { stringResource(R.string.wanted_deleted, it.name) }
    val rueckgaengig = stringResource(R.string.common_undo)
    LaunchedEffect(vorgemerkt) {
        val v = vorgemerkt ?: return@LaunchedEffect
        var zurueck = false
        try {
            zurueck = snackbarHostState.showSnackbar(text ?: v.name, rueckgaengig,
                duration = SnackbarDuration.Long) ==
                SnackbarResult.ActionPerformed
        } finally {
            if (zurueck) vm.wantedItemUndo(v) else vm.executeWantedItemDelete(v)
        }
    }
}

/** The watchlist-item detail as its own page (phone). */
@Composable
internal fun WantedItemDetailRoute(
    vm: MerklisteViewModel,
    setNumber: String,
    condition: Zustand,
    imageLoader: coil3.ImageLoader,
    onBack: () -> Unit,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val liste by vm.wantedState.collectAsStateWithLifecycle()
    val detail by remember(setNumber) { vm.wantedItemDetailOf(setNumber) }.collectAsStateWithLifecycle()
    val lagerZustand by vm.storageState.collectAsStateWithLifecycle()
    val ansicht = MerklisteZustand(appState, blick, liste, detail, lagerZustand)
    MerkpostenDetailScreen(ansicht, vm, setNumber, condition, imageLoader, onBack)
}

/**
 * The watchlist — as a list, because it's read and worked through: number, year,
 * condition and price alert side by side, as in the web app. The rules live on the
 * server (utils/merkliste.ts); the screen shows and calls.
 */
@Composable
internal fun MerklisteScreen(
    ansicht: MerklisteZustand,
    aktionen: MerklisteAktionen,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOeffnen: (String, Zustand) -> Unit,
    /** Set number and condition of the watchlist item whose detail is open next to it. */
    gewaehlt: Pair<String, Zustand>? = null,
) {
    val zustand = ansicht.liste
    // The image addresses point to one's own server (proxy), not raw at the
    // CDN — the same rule as in gallery, parts and finances.
    val appState = ansicht.appState
    val blick = ansicht.blick

    // Taking it over goes through the detail (MerkpostenDetailScreen), where quantity, purchase price
    // and condition are chosen; the row shows the market price for that.
    var openMask by rememberSaveable { mutableStateOf(false) }

    // ── The filter ──
    //
    // The same building blocks in the same order as in the gallery: account filter,
    // search field, chips. No storage-location filter — what you don't own sits nowhere; but
    // the condition, because the same set can stand new and used.
    val scopeMode = blick.scopeModes[ScopeFilter.View.MERKLISTE]
        ?: ScopeFilter.ALL
    // The input field holds its own text (typing stays smooth); the
    // debouncing lives in the ViewModel. If the value changes from outside, the
    // field follows — the same line as in the gallery.
    var searchInput by remember(zustand.query) { mutableStateOf(zustand.query) }

    // Two empty messages: "No watchlist items yet" says something about the list,
    // "nothing found" about the filter; a load error a third.
    val gefiltert = zustand.query.isNotBlank() ||
        zustand.stateFilter != null ||
        scopeMode != ScopeFilter.ALL
    val fehler = zustand.abruf.errorMessage?.satz()
    val anzeige = loadingIndicator(zustand.merkposten.isNotEmpty(), zustand.abruf.laedt, fehler, gefiltert)
    Box(Modifier.fillMaxSize()) {
        // Full width like every grid (Lesebreite.kt): centered at 840 dp, the price stood
        // 1200 px from the title on the tablet; in the grid it stays next to it.
        Column(Modifier.fillMaxSize()) {
            ScopeFilterRow(
                members  = blick.householdMembers,
                current  = scopeMode,
                onSelect = { aktionen.setScope(ScopeFilter.View.MERKLISTE, it) },
            )

            // Scan next to search as in the gallery: only ONE button floats at the bottom. In the
            // error state, neither search nor filter — there's nothing to search.
            // Without watchlist items, neither search nor filter: the empty message offers watchlisting and
            // scanning, a second scan button above would be the same path twice.
            val withHeader = anzeige != LoadingIndicator.FEHLER && anzeige != LoadingIndicator.LEER
            if (withHeader) Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Suchfeld(
                    wert = searchInput,
                    onValue = { searchInput = it; aktionen.setWantedSearch(it) },
                    platzhalter = stringResource(R.string.wanted_search),
                    modifier = Modifier.weight(1f),
                )
                SortierMenu(
                    optionen = Merksortierung.entries.map { it to it.beschriftung() },
                    gewaehlt = zustand.sorting,
                    onWahl = { aktionen.setWantedSorting(it) },
                    modifier = Modifier.padding(end = Abstaende.tiny),
                    vorgabe = Merksortierung.DEFAULT,
                )
                ScanButton({ onScan() }, Modifier.padding(end = 14.dp))
            }

            // The condition narrows the list: a filter, hence chips as in gallery and
            // finances; segments are only for views (sets | parts | minifigures).
            if (withHeader) StateFilterChips(
                gewaehlt = zustand.stateFilter,
                onWahl = { aktionen.setWantedState(it) },
                modifier = Modifier.padding(horizontal = Abstaende.edge).padding(bottom = Abstaende.klein),
            )

            Column(Modifier.fillMaxSize().padding(horizontal = Abstaende.edge)) {
                LoadState(
                    anzeige = anzeige,
                    fehler = fehler,
                    onErneut = { aktionen.loadWanted() },
                    // Like the empty gallery: say what the list is for, and offer both paths
                    // to the first entry — the same ones as the buttons at the bottom right.
                    leer = {
                        HintText(Icons.Default.BookmarkBorder, stringResource(R.string.wanted_empty),
                            stringResource(R.string.wanted_empty_hint))
                        ButtonStack {
                            Button(onClick = { openMask = true }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
                                Spacer(Modifier.width(Abstaende.klein))
                                Text(stringResource(R.string.wanted_add_first))
                            }
                            OutlinedButton(onClick = { onScan() }, modifier = Modifier.fillMaxWidth(), colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                                Icon(BarcodeSymbol, null, Modifier.size(withFont(18.dp)))
                                Spacer(Modifier.width(Abstaende.klein))
                                Text(stringResource(R.string.gallery_scan_barcode))
                            }
                        }
                    },
                    noHits = { NoHitsHint(stringResource(R.string.wanted_no_results)) },
                    errorClass = zustand.abruf.errorKind,
                ) {
                    BoxWithConstraints {
                    val multiColumn = maxWidth >= WANTED_COLUMN * 2
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(WANTED_COLUMN),
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        // Room for the add button: without it, it would cover the last row.
                        contentPadding = PaddingValues(bottom = FabSpace),
                    ) {
                        items(zustand.merkposten, key = ::wantedItemKey) { w ->
                            Moved {
                                WantedItemRow(w, appState.serverUrl, imageLoader,
                                    gewaehlt = gewaehlt == w.setNumber to w.condition,
                                    onOeffnen = { onOeffnen(w.setNumber, w.condition) }, multiColumn = multiColumn)
                            }
                        }
                    }
                    }
                }
            }
        }

        // A button as in the gallery; scan sits next to search. Not in the error state,
        // and not empty either: there "Watchlist set" already sits in the middle of the image.
        if (anzeige != LoadingIndicator.FEHLER && anzeige != LoadingIndicator.LEER) AddFab(
            stringResource(R.string.wanted_add_title), { openMask = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (openMask) {
        WantedItemAddDialog(
            householdMembers = blick.householdMembers,
            defaultCondition = appState.userDefaultCondition ?: Zustand.NEU,
            onDismiss = { openMask = false },
            createOn = { nummer, stateChoice, besitzer ->
                aktionen.legeMerkpostenAn(nummer, stateChoice, besitzer)
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
    ansicht: MerklisteZustand,
    aktionen: MerklisteAktionen,
    imageLoader: coil3.ImageLoader,
    sideBySide: Boolean,
    onScan: () -> Unit,
    onOpenSingle: (String, Zustand) -> Unit,
) {
    var offen by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val selection = offen?.let { it[0] to (Zustand.aus(it[1]) ?: Zustand.NEU) }
    val liste: @Composable () -> Unit = {
        MerklisteScreen(ansicht = ansicht, aktionen = aktionen, imageLoader = imageLoader, onScan = onScan,
            onOeffnen = { sn, z -> if (sideBySide) offen = listOf(sn, z.kennung) else onOpenSingle(sn, z) },
            gewaehlt = selection.takeIf { sideBySide })
    }
    if (sideBySide && selection != null) {
        ListAndDetail(
            liste = liste,
            detail = {
                // key: a different watchlist item is a different detail (dialogs, zoom close).
                androidx.compose.runtime.key(selection) {
                    val detail by remember { aktionen.wantedItemDetailOf(selection.first) }.collectAsStateWithLifecycle()
                    MerkpostenDetailScreen(ansicht = ansicht.copy(detail = detail), aktionen = aktionen, setNumber = selection.first, condition = selection.second,
                        imageLoader = imageLoader, onBack = { offen = null })
                }
            },
        )
    } else liste()
}

/** All | New | Used as filter chips; at large font size they wrap instead of being cut off. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StateFilterChips(gewaehlt: Zustand?, onWahl: (Zustand?) -> Unit, modifier: Modifier = Modifier) {
    val optionen = listOf(null to R.string.filter_condition_all, Zustand.NEU to R.string.condition_new,
        Zustand.GEBRAUCHT to R.string.condition_used)
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        optionen.forEach { (wert, text) ->
            AuswahlChip(selected = wert == gewaehlt, onClick = { onWahl(wert) }, label = { Text(stringResource(text)) })
        }
    }
}
