package ch.brickinventoryapp.sammlung.ui.screens

import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.fach.MetricsView
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.sammlung.ui.BarcodeUiState
import ch.brickinventoryapp.sammlung.ui.GalleryDisplay
import ch.brickinventoryapp.sammlung.ui.GalleryUiState
import ch.brickinventoryapp.sammlung.ui.galleryDisplay
import ch.brickinventoryapp.zustand.ui.ScopeUiState
import ch.brickinventoryapp.zustand.ui.Filterzahl
import ch.brickinventoryapp.zustand.ui.LagerUiState
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
import ch.brickinventoryapp.sammlung.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.gemeinsam.ui.GalleryStatChip
import ch.brickinventoryapp.gemeinsam.ui.MetricsSeries
import ch.brickinventoryapp.gemeinsam.ui.SearchWithFilter
import ch.brickinventoryapp.gemeinsam.ui.ActiveFilter
import ch.brickinventoryapp.gemeinsam.ui.accountFilter
import ch.brickinventoryapp.gemeinsam.ui.storageFilter
import ch.brickinventoryapp.gemeinsam.ui.partsBreakdown
import ch.brickinventoryapp.sammlung.ui.TilePrice

/** Was die Galerie zeigt; die Route sammelt es aus den Flüssen der ViewModels. */
internal data class GalleryState(
    val app: AppUiState,
    val blick: ScopeUiState,
    val galerie: GalleryUiState,
    val preise: Map<String, TilePrice>,
    val barcode: BarcodeUiState,
    val lager: LagerUiState,
)

/** Was die Galerie auslöst; die Route verdrahtet es mit GalleryViewModel und EntryViewModel. */
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
 * „gelöscht“ mit „Rückgängig“. Gelöscht wird erst, wenn die Snackbar ohne Rückgängig
 * endet — auch wenn sie verschwindet, weil man die Galerie verlässt. Jede Snackbar
 * antwortet nur für ihr Set: Löst ein zweites Löschen sie ab, bleibt dessen Rückgängig.
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

/** Die Galerie am Navigationsziel: sammelt die Flüsse und reicht Zustand und Ereignisse weiter. */
@Composable
fun GalleryRoute(
    vm: GalleryViewModel,
    /** Die Erfassung dieses Ziels; der Graph bindet sie an dessen Eintrag. */
    erfassung: EntryViewModel,
    imageLoader: ImageLoader,
    /** Barcode-Scanner öffnen — nur der Graph kennt den NavController. */
    onScanBarcode: () -> Unit,
    /** Klick auf ein Set, ebenso. */
    onSetClick: (String) -> Unit,
    /** Scroll-Zustand von aussen, damit er den Weg in die Detailansicht übersteht. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    // Eigener Fluss fuer die Galerie: Blaettern, Suchen und Nachladen aendern
    // nur DIESEN Zustand (siehe GalleryUiState).
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
            // Auch die Filterlisten: Sie werden sonst nur beim Start geladen.
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

    // ── Erfolgloser Scan öffnet die manuelle Erfassung ──
    //
    // Die erfolglosen Wege (EAN nicht auflösbar, ohne Setnummer, Texterkennung ohne
    // Treffer) melden sich über ein Feld im Zustand; hier abgeholt und quittiert,
    // sonst ginge der Dialog beim nächsten Zusammensetzen erneut auf.
    LaunchedEffect(zustand.barcode.manuelleErfassungAnfordern) {
        if (zustand.barcode.manuelleErfassungAnfordern) {
            showAddDialog = true
            events.manualEntryAcknowledged()
        }
    }
    // Das Eingabefeld hält seinen Text selbst (Tippen bleibt flüssig); die
    // Entprellung und der Abruf liegen im ViewModel, weil dort auch die
    // Filter-Generation hängt. Wechselt der Wert von aussen (Anmeldung,
    // Zurücksetzen), zieht das Feld nach.
    var searchInput by remember(galerie.galleryQuery) { mutableStateOf(galerie.galleryQuery) }
    var showFilter by rememberSaveable { mutableStateOf(false) }

    // Kein lokales Filtern und keine Themenliste aus `sets`: Der Schirm zeigt, was der
    // Server geliefert hat — eine zweite Suche hier kennte weder Jahr noch Sortierung,
    // und die Themen kämen aus der geladenen Seite statt aus dem Bestand.

    val anzeige = galleryDisplay(galerie, gefiltert = searchInput.isNotBlank() || galerie.galleryTheme.isNotEmpty())
    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SearchWithFilter).
    val gross = largeFont()
    val addText = stringResource(R.string.gallery_add_set)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Suche und ein Knopf für alles andere: Konto, Lagerort, Thema und
            // Sortierung stehen im Blatt; die Kennzahlen rollen mit dem Raster. Scannen
            // sitzt daneben, damit unten nur EIN Knopf schwebt. Im Fehlerzustand nicht:
            // Ohne Sammlung gibt es nichts zu suchen.
            if (anzeige != GalleryDisplay.FEHLER && anzeige != GalleryDisplay.LEER) GallerySearch(
                zustand, events, searchInput, { searchInput = it }, onScanBarcode,
                onFilter = { showFilter = true }, erfassen = addText to { showAddDialog = true },
            )

            OfflineHint(galerie.offlineStatus, onErneut = events.aktualisieren)
            // Der Kringel des Ziehens nur über einer Liste: Beim ersten Laden zeigt das
            // Skelett schon, dass etwas kommt, zwei Ladeanzeigen übereinander wirkten unruhig.
            PullToRefreshBox(isRefreshing = galerie.abruf.laedt && anzeige == GalleryDisplay.LISTE,
                             onRefresh = events.aktualisieren, modifier = Modifier.fillMaxSize()) {
                GalleryContent(anzeige, zustand, searchInput, imageLoader, gridState, onSetClick,
                    onScanBarcode, addOn = { showAddDialog = true }, onRefresh = events.aktualisieren)
            }
        }

        // Erfassen erst, wenn die Sammlung da ist: Im Fehlerzustand gehört der Blick dem
        // Grund und dem „Erneut versuchen“, nicht einem Knopf, der ins Leere ginge.
        // Leer auch nicht: Die Leermeldung bietet Erfassen und Scannen selbst an.
        if (!gross && anzeige != GalleryDisplay.FEHLER && anzeige != GalleryDisplay.LEER) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (showFilter) GalerieFilter(zustand, events, onSchliessen = { showFilter = false })
    if (showAddDialog) GalerieErfassen(zustand, events, onSchliessen = { showAddDialog = false })
}

/** Der Bereich des Kontos und der gewählte Lagerort der Galerie. */
internal fun GalleryState.accountChoice(): String =
    blick.scopeModes[ScopeFilter.View.GALLERY] ?: ScopeFilter.ALL

internal fun GalleryState.storageChoice(): String =
    lager.modi[ScopeFilter.View.GALLERY] ?: ""

/** Suche, Filterknopf, Scannen und Sortierung über dem Raster. */
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

/** Was unter der Suche steht: Skelett, Fehler, leere Sammlung, keine Treffer oder das Raster. */
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
        // Fehler und leere Sammlung sehen verschieden aus und bieten
        // Verschiedenes an: hier den Grund und einen neuen Versuch.
        GalleryDisplay.FEHLER -> GalleryHint {
            ErrorHint(galerie.abruf.errorMessage?.satz(), onRefresh,
                galerie.abruf.errorKind)
        }
        GalleryDisplay.LEER -> GalleryEmpty(addOn, onScanBarcode)
        GalleryDisplay.NO_HITS -> GalleryHint {
            // Die Kennzahlen meinen die ganze Sammlung — auch ohne Treffer.
            if (stats != null) GalleryMetrics(stats)
            EmptySymbol(Icons.Default.SearchOff)
            Text(stringResource(R.string.gallery_no_results, suchtext), fontWeight = FontWeight.SemiBold)
        }
        GalleryDisplay.LISTE -> GalleryRaster(zustand, imageLoader, gridState, onSetClick)
    }
}

/** Die leere Sammlung: Erfassen und Scannen, derselbe Dialog wie der Plus-Knopf. */
@Composable
private fun GalleryEmpty(addOn: () -> Unit, onScanBarcode: () -> Unit) {
    GalleryHint {
        Image(painterResource(R.drawable.ic_logo), null, Modifier.size(64.dp))
        Text(stringResource(R.string.gallery_no_sets), fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.gallery_empty_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center)
        // Derselbe Dialog wie der Plus-Knopf — kein zweiter Erfassungsweg.
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

/** Kennzahlen und Kacheln; das Set, dessen Detail daneben offen ist, ist markiert. */
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
    // Listenzeilen, sobald nur eine Spalte Platz hat oder die Schrift gross ist: Bei 130 %
    // stand sonst eine Kachel über die ganze Breite, das Bild nahm zwei Drittel der Höhe
    // und ein Set füllte den Bildschirm.
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

/** Die Kennzahlen der Sammlung — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun GalleryMetrics(stats: MetricsView) {
    MetricsSeries {
        GalleryStatChip(stats.totalSets, R.plurals.gallery_stat_sets)
        GalleryStatChip(stats.totalQuantity, R.plurals.gallery_stat_units)
        GalleryStatChip(stats.totalParts, R.plurals.gallery_stat_parts,
            partsBreakdown(stats.partsFromSets, stats.partsSingle))
        // Alle Kennzahlen immer, auch mit 0: Eine Reihe, deren Chips je nach Bestand
        // kommen und gehen, liest sich nicht gleich; 0 Figuren ist auch eine Auskunft.
        GalleryStatChip(stats.totalMinifigs, R.plurals.gallery_stat_minifigs)
        GalleryStatChip(stats.totalInstructions, R.plurals.gallery_stat_instructions)
    }
}

/**
 * Mittig, scrollbar und mit Rand: Der Inhalt muss auch im Querformat ganz
 * erreichbar sein, und PullToRefreshBox braucht ein scrollbares Kind, damit
 * Ziehen zum Neuladen weiter geht.
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

/** Beschriftung einer Sortierung; vollständig, damit ein neuer Wert hier auffällt. */
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

/** Dieselben Beschriftungen für die Merkliste; dort ohne Menge. */
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
