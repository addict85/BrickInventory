package ch.brickinventoryapp.sammlung.ui.screens

import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.ui.model.KennzahlenAnsicht
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.components.SortierMenue
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT
import ch.brickinventoryapp.ui.components.BarcodeSymbol
import ch.brickinventoryapp.ui.components.ErfassenFab
import ch.brickinventoryapp.ui.components.FabPlatz
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.KnopfStapel
import ch.brickinventoryapp.ui.components.LesbareSpalten
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.OfflineHinweis
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.gemeinsam.ui.GalleryStatChip
import ch.brickinventoryapp.gemeinsam.ui.KennzahlenReihe
import ch.brickinventoryapp.gemeinsam.ui.SucheMitFilter
import ch.brickinventoryapp.gemeinsam.ui.teileAufschluesselung
import ch.brickinventoryapp.sammlung.ui.KachelPreis

/** Was die Galerie zeigt; die Route sammelt es aus den Flüssen der ViewModels. */
data class GalerieZustand(
    val app: AppUiState,
    val blick: BlickfeldUiState,
    val galerie: GalleryUiState,
    val preise: Map<String, KachelPreis>,
    val barcode: BarcodeUiState,
    val lager: LagerUiState,
)

/** Was die Galerie auslöst; die Route verdrahtet es mit GalerieViewModel und ErfassungViewModel. */
class GalerieEreignisse(
    val suche: (String) -> Unit,
    val thema: (String) -> Unit,
    val sortierung: (String) -> Unit,
    val mehrLaden: () -> Unit,
    val konto: (String) -> Unit,
    val lagerort: (String) -> Unit,
    val aktualisieren: () -> Unit,
    val setErfassen: (Erfassungswunsch) -> Unit,
    val manuelleErfassungQuittiert: () -> Unit,
)

/**
 * „gelöscht“ mit „Rückgängig“. Gelöscht wird erst, wenn die Snackbar ohne Rückgängig
 * endet — auch wenn sie verschwindet, weil man die Galerie verlässt. Jede Snackbar
 * antwortet nur für ihr Set: Löst ein zweites Löschen sie ab, bleibt dessen Rückgängig.
 */
@Composable
internal fun GalerieRueckgaengigRoute(vm: GalerieViewModel, snackbarHostState: SnackbarHostState) {
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
            if (zurueck) vm.rueckgaengig(v) else vm.loeschenAusfuehren(v)
        }
    }
}

/** Die Galerie am Navigationsziel: sammelt die Flüsse und reicht Zustand und Ereignisse weiter. */
@Composable
fun GalleryRoute(
    vm: GalerieViewModel,
    /** Die Erfassung dieses Ziels; der Graph bindet sie an dessen Eintrag. */
    erfassung: ErfassungViewModel,
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
    val lagerState by vm.lagerState.collectAsStateWithLifecycle()
    val ereignisse = remember(vm, erfassung) {
        GalerieEreignisse(
            suche = vm::setGalleryQuery,
            thema = vm::setGalleryTheme,
            sortierung = vm::setGallerySort,
            mehrLaden = vm::loadMoreSets,
            konto = { vm.setScope(ScopeFilter.View.GALLERY, it) },
            lagerort = { vm.setLagerFilter(ScopeFilter.View.GALLERY, it) },
            // Auch die Filterlisten: Sie werden sonst nur beim Start geladen.
            aktualisieren = vm::aktualisieren,
            setErfassen = erfassung::addSet,
            manuelleErfassungQuittiert = { erfassung.manuelleErfassungQuittieren() },
        )
    }
    GalleryScreen(
        zustand = GalerieZustand(state, blick, galerie, preise, barcodeState, lagerState),
        ereignisse = ereignisse,
        imageLoader = imageLoader,
        onScanBarcode = onScanBarcode,
        onSetClick = onSetClick,
        gridState = gridState,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryScreen(
    zustand: GalerieZustand,
    ereignisse: GalerieEreignisse,
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
            ereignisse.manuelleErfassungQuittiert()
        }
    }
    // Das Eingabefeld hält seinen Text selbst (Tippen bleibt flüssig); die
    // Entprellung und der Abruf liegen im ViewModel, weil dort auch die
    // Filter-Generation hängt. Wechselt der Wert von aussen (Anmeldung,
    // Zurücksetzen), zieht das Feld nach.
    var searchInput by remember(galerie.galleryQuery) { mutableStateOf(galerie.galleryQuery) }
    var zeigeFilter by rememberSaveable { mutableStateOf(false) }

    // Kein lokales Filtern und keine Themenliste aus `sets`: Der Schirm zeigt, was der
    // Server geliefert hat — eine zweite Suche hier kennte weder Jahr noch Sortierung,
    // und die Themen kämen aus der geladenen Seite statt aus dem Bestand.

    // Endlos-Scroll: nachladen, sobald die letzten Kacheln in Sicht kommen.
    LaunchedEffect(gridState, galerie.sets.size, galerie.galleryTotal) {
        snapshotFlow {
            val letzte = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            letzte >= galerie.sets.size - 6 && galerie.sets.isNotEmpty()
        }.collect { nah -> if (nah) ereignisse.mehrLaden() }
    }

    val anzeige = galerieAnzeige(galerie, gefiltert = searchInput.isNotBlank() || galerie.galleryTheme.isNotEmpty())
    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SucheMitFilter).
    val gross = grosseSchrift()
    val erfassenText = stringResource(R.string.gallery_add_set)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Suche und ein Knopf für alles andere: Konto, Lagerort, Thema und
            // Sortierung stehen im Blatt; die Kennzahlen rollen mit dem Raster. Scannen
            // sitzt daneben, damit unten nur EIN Knopf schwebt. Im Fehlerzustand nicht:
            // Ohne Sammlung gibt es nichts zu suchen.
            if (anzeige != GalerieAnzeige.FEHLER && anzeige != GalerieAnzeige.LEER) GalerieSuche(
                zustand, ereignisse, searchInput, { searchInput = it }, onScanBarcode,
                onFilter = { zeigeFilter = true }, erfassen = erfassenText to { showAddDialog = true },
            )

            OfflineHinweis(galerie.offlineStand)
            // Der Kringel des Ziehens nur über einer Liste: Beim ersten Laden zeigt das
            // Skelett schon, dass etwas kommt, zwei Ladeanzeigen übereinander wirkten unruhig.
            PullToRefreshBox(isRefreshing = galerie.galleryLoading && anzeige == GalerieAnzeige.LISTE,
                             onRefresh = ereignisse.aktualisieren, modifier = Modifier.fillMaxSize()) {
                GalerieInhalt(anzeige, zustand, searchInput, imageLoader, gridState, onSetClick,
                    onScanBarcode, onErfassen = { showAddDialog = true }, onRefresh = ereignisse.aktualisieren)
            }
        }

        // Erfassen erst, wenn die Sammlung da ist: Im Fehlerzustand gehört der Blick dem
        // Grund und dem „Erneut versuchen“, nicht einem Knopf, der ins Leere ginge.
        // Leer auch nicht: Die Leermeldung bietet Erfassen und Scannen selbst an.
        if (!gross && anzeige != GalerieAnzeige.FEHLER && anzeige != GalerieAnzeige.LEER) ErfassenFab(
            erfassenText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (zeigeFilter) GalerieFilter(zustand, ereignisse, onSchliessen = { zeigeFilter = false })
    if (showAddDialog) GalerieErfassen(zustand, ereignisse, onSchliessen = { showAddDialog = false })
}

/** Der Bereich des Kontos und der gewählte Lagerort der Galerie. */
internal fun GalerieZustand.kontoWahl(): String =
    blick.scopeModes[ScopeFilter.View.GALLERY] ?: ScopeFilter.ALL

internal fun GalerieZustand.lagerWahl(): String =
    lager.modi[ScopeFilter.View.GALLERY] ?: ""

/** Suche, Filterknopf, Scannen und Sortierung über dem Raster. */
@Composable
private fun GalerieSuche(
    zustand: GalerieZustand,
    ereignisse: GalerieEreignisse,
    suchtext: String,
    onSuchtext: (String) -> Unit,
    onScanBarcode: () -> Unit,
    onFilter: () -> Unit,
    erfassen: Pair<String, () -> Unit>,
) {
    val galerie = zustand.galerie
    SucheMitFilter(
        wert = suchtext,
        onWert = { onSuchtext(it); ereignisse.suche(it) },
        platzhalter = stringResource(R.string.gallery_search_placeholder),
        aktiveFilter = Filterzahl.galerie(zustand.blick.householdMembers, zustand.kontoWahl(), zustand.lager.orte,
            zustand.lagerWahl(), galerie.galleryTheme),
        onFilter = onFilter,
        onScannen = onScanBarcode,
        erfassen = erfassen,
        sortierung = {
            // Dieselben Werte wie SET_SORTS auf dem Server (utils/handlers.ts):
            // Einen unbekannten Wert setzte er still auf die Vorgabe zurück.
            SortierMenue(
                optionen = listOf("added_desc", "added_asc", "name_asc", "num_asc",
                                  "year_desc", "price_desc", "price_asc",
                                  "qty_desc", "qty_asc").map { it to gallerySortLabel(it) },
                gewaehlt = galerie.gallerySort, onWahl = ereignisse.sortierung,
                vorgabe = GALLERY_DEFAULT_SORT,
            )
        },
    )
}

/** Was unter der Suche steht: Skelett, Fehler, leere Sammlung, keine Treffer oder das Raster. */
@Composable
private fun GalerieInhalt(
    anzeige: GalerieAnzeige,
    zustand: GalerieZustand,
    suchtext: String,
    imageLoader: ImageLoader,
    gridState: LazyGridState,
    onSetClick: (String) -> Unit,
    onScanBarcode: () -> Unit,
    onErfassen: () -> Unit,
    onRefresh: () -> Unit,
) {
    val galerie = zustand.galerie
    val stats = galerie.stats
    when (anzeige) {
        GalerieAnzeige.LAEDT -> SkelettRaster(LesbareSpalten(160.dp), kachelHoehe = 252.dp,
            kopfzeile = true, bildVerhaeltnis = BILD_SEITENVERHAELTNIS)
        // Fehler und leere Sammlung sehen verschieden aus und bieten
        // Verschiedenes an: hier den Grund und einen neuen Versuch.
        GalerieAnzeige.FEHLER -> GalerieHinweis {
            FehlerHinweis(galerie.galleryFehler, onRefresh,
                galerie.galleryFehlerKlasse)
        }
        GalerieAnzeige.LEER -> GalerieLeer(onErfassen, onScanBarcode)
        GalerieAnzeige.KEINE_TREFFER -> GalerieHinweis {
            // Die Kennzahlen meinen die ganze Sammlung — auch ohne Treffer.
            if (stats != null) GalerieKennzahlen(stats)
            LeerSymbol(Icons.Default.SearchOff)
            Text(stringResource(R.string.gallery_no_results, suchtext), fontWeight = FontWeight.SemiBold)
        }
        GalerieAnzeige.LISTE -> GalerieRaster(zustand, imageLoader, gridState, onSetClick)
    }
}

/** Die leere Sammlung: Erfassen und Scannen, derselbe Dialog wie der Plus-Knopf. */
@Composable
private fun GalerieLeer(onErfassen: () -> Unit, onScanBarcode: () -> Unit) {
    GalerieHinweis {
        Image(painterResource(R.drawable.ic_logo), null, Modifier.size(64.dp))
        Text(stringResource(R.string.gallery_no_sets), fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.gallery_empty_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center)
        // Derselbe Dialog wie der Plus-Knopf — kein zweiter Erfassungsweg.
        KnopfStapel {
            Button(onClick = onErfassen, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Add, null, Modifier.size(mitSchrift(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.gallery_add_first))
            }
            OutlinedButton(onClick = onScanBarcode, modifier = Modifier.fillMaxWidth(), colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                Icon(BarcodeSymbol, null, Modifier.size(mitSchrift(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.gallery_scan_barcode))
            }
        }
    }
}

/** Kennzahlen und Kacheln; das Set, dessen Detail daneben offen ist, ist markiert. */
@Composable
private fun GalerieRaster(
    zustand: GalerieZustand,
    imageLoader: ImageLoader,
    gridState: LazyGridState,
    onSetClick: (String) -> Unit,
) {
    val galerie = zustand.galerie
    val stats = galerie.stats
    val gewaehlt = LocalOffenesDetail.current
    LazyVerticalGrid(
        columns = LesbareSpalten(160.dp),
        state = gridState,
        contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel, end = Abstaende.mittel,
            bottom = FabPlatz),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (stats != null) {
            item(key = "gallery-stats", span = { GridItemSpan(maxLineSpan) }) {
                GalerieKennzahlen(stats)
            }
        }
        itemsIndexed(galerie.sets, key = { _, s -> s.setNumber }) { index, set ->
            Bewegt {
                SetCard(set, zustand.app.serverUrl, imageLoader, onSetClick, index,
                    preis = zustand.preise[set.setNumber], waehrung = zustand.app.currency,
                    ausgewaehlt = set.setNumber == gewaehlt)
            }
        }
        if (galerie.galleryLoadingMore) {
            // Ein fester Schlüssel für den Lade-Eintrag: Ohne bekäme er einen aus
            // dem Index gebildeten Ersatz, der beim Wachsen der Liste wechselt —
            // für das Raster verschwände dann ein Eintrag und ein anderer
            // erschiene.
            item(key = "gallery-loading-more", span = { GridItemSpan(maxLineSpan) }) {
                Box(Modifier.fillMaxWidth().padding(Abstaende.gross), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                }
            }
        }
    }
}

/** Die Kennzahlen der Sammlung — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun GalerieKennzahlen(stats: KennzahlenAnsicht) {
    KennzahlenReihe {
        GalleryStatChip(stats.totalSets, R.plurals.gallery_stat_sets)
        GalleryStatChip(stats.totalQuantity, R.plurals.gallery_stat_units)
        GalleryStatChip(stats.totalParts, R.plurals.gallery_stat_parts,
            teileAufschluesselung(stats.teileAusSets, stats.teileEinzeln))
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
private fun GalerieHinweis(inhalt: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Abstaende.riesig),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein, Alignment.CenterVertically),
        content = inhalt,
    )
}

/**
 * Beschriftung eines Sortierwerts; die Werte sind die des Servers (SET_SORTS),
 * hier wird nur übersetzt. `internal`, weil die Merkliste dieselben Werte unter
 * denselben Beschriftungen braucht — eine zweite Fassung würde bei einer
 * Umbenennung nur zur Hälfte nachgezogen.
 */
@Composable
internal fun gallerySortLabel(wert: String): String = when (wert) {
    "added_asc"  -> stringResource(R.string.gallery_sort_added_asc)
    "name_asc"   -> stringResource(R.string.gallery_sort_name)
    "num_asc"    -> stringResource(R.string.gallery_sort_number)
    "year_desc"  -> stringResource(R.string.gallery_sort_year_desc)
    "price_desc" -> stringResource(R.string.gallery_sort_price_desc)
    "price_asc"  -> stringResource(R.string.gallery_sort_price_asc)
    "qty_desc"   -> stringResource(R.string.gallery_sort_qty_desc)
    "qty_asc"    -> stringResource(R.string.gallery_sort_qty_asc)
    else         -> stringResource(R.string.gallery_sort_added_desc)
}
