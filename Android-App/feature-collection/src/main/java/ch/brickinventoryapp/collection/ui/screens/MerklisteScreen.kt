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
 * Der Schlüssel einer Zeile: Nummer, Zustand und Konto. Dasselbe Set kann neu und
 * gebraucht und bei zwei Konten dastehen; mit der Nummer allein verlöre Compose
 * die Zuordnung.
 */
private fun wantedItemKey(w: WantedItemView) = "${w.setNumber}|${w.condition.kennung}|${w.userId}"

/** Was Merkliste und Merkposten-Detail zeigen; die Route sammelt es aus den Flüssen. */
internal data class MerklisteZustand(
    val appState: AppUiState,
    val blick: ScopeUiState,
    val liste: WantedUiState,
    val detail: WantedItemDetailUiState,
    val lagerZustand: LagerUiState,
)

/** Merkliste und Detail am Navigationsziel: ein ViewModel für beide Hälften. */
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
 * „von der Merkliste genommen“ mit „Rückgängig“. Gelöscht wird erst, wenn die Snackbar
 * ohne Rückgängig endet — auch wenn sie verschwindet, weil man die Merkliste verlässt.
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

/** Das Merkposten-Detail als eigene Seite (Telefon). */
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
 * Die Merkliste — als Liste, weil sie gelesen und abgearbeitet wird: Nummer, Jahr,
 * Zustand und Preisalarm nebeneinander, wie in der Webapp. Die Regeln stehen am
 * Server (utils/merkliste.ts); der Bildschirm zeigt und ruft.
 */
@Composable
internal fun MerklisteScreen(
    ansicht: MerklisteZustand,
    aktionen: MerklisteAktionen,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOeffnen: (String, Zustand) -> Unit,
    /** Setnummer und Zustand des Merkpostens, dessen Detail daneben offen ist. */
    gewaehlt: Pair<String, Zustand>? = null,
) {
    val zustand = ansicht.liste
    // Die Bildadressen zeigen auf den eigenen Server (Proxy), nicht roh aufs
    // CDN — dieselbe Regel wie in Galerie, Teilen und Finanzen.
    val appState = ansicht.appState
    val blick = ansicht.blick

    // Übernommen wird über das Detail (MerkpostenDetailScreen), wo Anzahl, Kaufpreis
    // und Zustand zur Wahl stehen; die Zeile zeigt dafür den Marktpreis.
    var openMask by rememberSaveable { mutableStateOf(false) }

    // ── Der Filter ──
    //
    // Dieselben Bausteine in derselben Reihenfolge wie in der Galerie: Kontofilter,
    // Suchfeld, Chips. Kein Lagerortfilter — was man nicht hat, liegt nirgends; dafür
    // der Zustand, weil dasselbe Set neu und gebraucht dastehen kann.
    val scopeMode = blick.scopeModes[ScopeFilter.View.MERKLISTE]
        ?: ScopeFilter.ALL
    // Das Eingabefeld haelt seinen Text selbst (Tippen bleibt fluessig); die
    // Entprellung liegt im ViewModel. Wechselt der Wert von aussen, zieht das
    // Feld nach — dieselbe Zeile wie in der Galerie.
    var searchInput by remember(zustand.query) { mutableStateOf(zustand.query) }

    // Zwei Leermeldungen: „Noch keine Merkposten“ sagt etwas über die Liste,
    // „nichts gefunden“ über den Filter; ein Ladefehler eine dritte.
    val gefiltert = zustand.query.isNotBlank() ||
        zustand.stateFilter != null ||
        scopeMode != ScopeFilter.ALL
    val fehler = zustand.abruf.errorMessage?.satz()
    val anzeige = loadingIndicator(zustand.merkposten.isNotEmpty(), zustand.abruf.laedt, fehler, gefiltert)
    Box(Modifier.fillMaxSize()) {
        // Volle Breite wie jedes Raster (Lesebreite.kt): Mittig auf 840 dp stand der Preis
        // auf dem Tablet 1200 px vom Titel entfernt; im Raster bleibt er neben ihm.
        Column(Modifier.fillMaxSize()) {
            ScopeFilterRow(
                members  = blick.householdMembers,
                current  = scopeMode,
                onSelect = { aktionen.setScope(ScopeFilter.View.MERKLISTE, it) },
            )

            // Scannen neben der Suche wie in der Galerie: unten schwebt nur EIN Knopf. Im
            // Fehlerzustand weder Suche noch Filter — es gibt nichts zu durchsuchen.
            // Ohne Merkposten weder Suche noch Filter: Die Leermeldung bietet Merken und
            // Scannen an, ein zweiter Scan-Knopf darüber wäre derselbe Weg noch einmal.
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

            // Der Zustand schränkt die Liste ein: ein Filter, also Chips wie in Galerie und
            // Finanzen; Segmente stehen nur für Ansichten (Sets | Teile | Minifiguren).
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
                    // Wie die leere Galerie: sagen, wozu die Liste da ist, und beide Wege
                    // zum ersten Eintrag anbieten — dieselben wie die Knöpfe unten rechts.
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
                        // Platz für den Erfassen-Knopf: Ohne ihn verdeckt er die letzte Zeile.
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

        // Ein Knopf wie in der Galerie; Scannen steht neben der Suche. Im Fehlerzustand
        // nicht, und leer auch nicht: Dort steht „Set merken“ schon mitten im Bild.
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
 * Die Merkliste mit dem Detail des geöffneten Merkpostens daneben, wenn
 * [sideBySide] (breites Fenster, listAndDetail()); sonst öffnet [onOpenSingle]
 * das Detail als eigene Seite. Ein Zustand für beide Hälften: dasselbe ViewModel.
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
                // key: Ein anderer Merkposten ist ein anderes Detail (Dialoge, Zoom zu).
                androidx.compose.runtime.key(selection) {
                    val detail by remember { aktionen.wantedItemDetailOf(selection.first) }.collectAsStateWithLifecycle()
                    MerkpostenDetailScreen(ansicht = ansicht.copy(detail = detail), aktionen = aktionen, setNumber = selection.first, condition = selection.second,
                        imageLoader = imageLoader, onBack = { offen = null })
                }
            },
        )
    } else liste()
}

/** Alle | Neu | Gebraucht als Filterchips; bei grosser Schrift brechen sie um statt abzuschneiden. */
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
