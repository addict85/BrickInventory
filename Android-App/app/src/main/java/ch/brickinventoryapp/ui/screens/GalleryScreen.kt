package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsNoppeTheme
import ch.brickinventoryapp.ui.theme.LocalIstGlanz
import ch.brickinventoryapp.ui.theme.LichtStreifen
import ch.brickinventoryapp.ui.theme.steinTon
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.NoppenReihe
import ch.brickinventoryapp.ui.theme.SteinKantenVerlauf
import ch.brickinventoryapp.ui.theme.NoppenMass
import ch.brickinventoryapp.util.fmtInt
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.fmtProzent
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.compose.AsyncImage
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.debounce
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.data.model.DashboardStats

@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
fun GalleryScreen(
    vm: GalerieViewModel,
    /** Erfassen und Scannen gehören der ganzen App, nicht der Galerie. */
    erfassung: ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel,
    imageLoader: ImageLoader,
    /** Barcode-Scanner öffnen — nur der Graph kennt den NavController. */
    onScanBarcode: () -> Unit,
    /** Klick auf ein Set, ebenso. */
    onSetClick: (String) -> Unit,
    /** Scroll-Zustand von aussen, damit er den Weg in die Detailansicht übersteht. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    // Zustand und Aktionen vom ViewModel statt über Parameter (wie PartsScreen); die
    // Namen bleiben dieselben, damit der Rumpf darunter unverändert ist.
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    // Eigener Fluss fuer die Galerie: Blaettern, Suchen und Nachladen aendern
    // nur noch DIESEN Zustand — die uebrigen Bildschirme, die `vm.state`
    // sammeln, werden dadurch nicht mehr mit rekomponiert (siehe GalleryUiState).
    val galerie by vm.galleryState.collectAsStateWithLifecycle()
    val preise by vm.preise.collectAsStateWithLifecycle()
    val barcodeState by erfassung.barcodeState.collectAsStateWithLifecycle()
    // Eigener Fluss: Der Lagerortfilter gehoert nicht in AppUiState, das
    // sechzehn Dateien sammeln (siehe LagerUiState).
    val lagerState by vm.lagerState.collectAsStateWithLifecycle()

    val sets = galerie.sets
    val query = galerie.galleryQuery
    val theme = galerie.galleryTheme
    val sort = galerie.gallerySort
    val themes = galerie.galleryThemes
    val total = galerie.galleryTotal
    val loadingMore = galerie.galleryLoadingMore
    val stats = galerie.stats
    val isLoading = galerie.galleryLoading
    val serverUrl = state.serverUrl
    val defaultCondition = state.userDefaultCondition ?: "N"
    val currency = state.currency
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.GALLERY.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL

    val onQueryChange: (String) -> Unit = vm::setGalleryQuery
    val onThemeChange: (String) -> Unit = vm::setGalleryTheme
    val onSortChange: (String) -> Unit = vm::setGallerySort
    val onLoadMore: () -> Unit = vm::loadMoreSets
    val onDeleteSet: (String) -> Unit = vm::deleteSet
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.GALLERY, it) }
    val lagerorte = lagerState.orte
    val lagerModus = lagerState.modi[ch.brickinventoryapp.data.ScopeFilter.View.GALLERY.key] ?: ""
    val onLagerChange: (String) -> Unit = { vm.setLagerFilter(ch.brickinventoryapp.data.ScopeFilter.View.GALLERY, it) }
    // Auch die Filterlisten: Sie werden sonst nur beim Start geladen, und eine
    // dort gescheiterte Anfrage liesse Konto- und Lagerortfilter bis zum
    // naechsten Start verschwinden.
    val onRefresh: () -> Unit = vm::aktualisieren
    val onAddSet: (String, Int, Double?, String?, Int?, String?) -> Unit =
        { sn, qty, price, cond, owner, ort -> erfassung.addSet(sn, qty, price, cond, owner, ort) }
    // Der VORRAT, nicht die belegten Orte: `lagerorte` eine Zeile weiter oben
    // speist den FILTER und enthaelt nur, worin schon etwas liegt. Beim
    // Erfassen soll auch ein leeres Regal zur Wahl stehen.
    val lagerortVorrat = lagerState.eigene.map { it.name }

    var showAddDialog by rememberSaveable { mutableStateOf(false) }

    // ── Erfolgloser Scan öffnet die manuelle Erfassung ──
    //
    // Die erfolglosen Wege (EAN nicht auflösbar, ohne Setnummer, Texterkennung ohne
    // Treffer) melden sich über ein Feld im Zustand; hier abgeholt und quittiert,
    // sonst ginge der Dialog beim nächsten Zusammensetzen erneut auf.
    LaunchedEffect(barcodeState.manuelleErfassungAnfordern) {
        if (barcodeState.manuelleErfassungAnfordern) {
            showAddDialog = true
            erfassung.manuelleErfassungQuittieren()
        }
    }
    // Das Eingabefeld hält seinen Text selbst (Tippen bleibt flüssig); die
    // Entprellung und der Abruf liegen im ViewModel, weil dort auch die
    // Filter-Generation hängt. Wechselt der Wert von aussen (Anmeldung,
    // Zurücksetzen), zieht das Feld nach.
    var searchInput by remember(query) { mutableStateOf(query) }
    var zeigeFilter by rememberSaveable { mutableStateOf(false) }

    // Kein lokales Filtern und keine Themenliste aus `sets`: Der Schirm zeigt, was der
    // Server geliefert hat — eine zweite Suche hier kennte weder Jahr noch Sortierung,
    // und die Themen kämen aus der geladenen Seite statt aus dem Bestand.

    // Endlos-Scroll: nachladen, sobald die letzten Kacheln in Sicht kommen.
    LaunchedEffect(gridState, sets.size, total) {
        snapshotFlow {
            val letzte = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            letzte >= sets.size - 6 && sets.isNotEmpty()
        }.collect { nah -> if (nah) onLoadMore() }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {

            // Suche und ein Knopf für alles andere: Konto, Lagerort, Thema und
            // Sortierung stehen im Blatt; die Kennzahlen rollen mit dem Raster.
            SucheMitFilter(
                wert = searchInput,
                onWert = { searchInput = it; onQueryChange(it) },
                platzhalter = stringResource(R.string.gallery_search_placeholder),
                aktiveFilter = Filterzahl.galerie(householdMembers, scopeMode, lagerorte, lagerModus, theme, sort),
                onFilter = { zeigeFilter = true },
            )

            ch.brickinventoryapp.ui.components.OfflineHinweis(galerie.offlineStand)
            PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
                when (galerieAnzeige(galerie, gefiltert = searchInput.isNotBlank() || theme.isNotEmpty())) {
                    GalerieAnzeige.LAEDT -> SkelettRaster(GridCells.Adaptive(160.dp), kachelHoehe = 272.dp)
                    // Fehler und leere Sammlung sehen verschieden aus und bieten
                    // Verschiedenes an: hier den Grund und einen neuen Versuch.
                    GalerieAnzeige.FEHLER -> GalerieHinweis {
                        LeerSymbol(Icons.Default.CloudOff)
                        Text(stringResource(R.string.gallery_load_failed), fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center)
                        Text(galerie.galleryFehler.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center)
                        Button(onClick = onRefresh, shape = Formen.knopf) { Text(stringResource(R.string.gallery_retry)) }
                    }
                    GalerieAnzeige.LEER -> GalerieHinweis {
                        Image(painterResource(R.drawable.ic_logo), null, Modifier.size(64.dp))
                        Text(stringResource(R.string.gallery_no_sets), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.gallery_empty_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center)
                        // Derselbe Dialog wie der Plus-Knopf — kein zweiter Erfassungsweg.
                        Button(onClick = { showAddDialog = true }, shape = Formen.knopf) {
                            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(Abstaende.klein))
                            Text(stringResource(R.string.gallery_add_first))
                        }
                        OutlinedButton(onClick = onScanBarcode, shape = Formen.knopf) {
                            Icon(Icons.Default.QrCodeScanner, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(Abstaende.klein))
                            Text(stringResource(R.string.gallery_scan_barcode))
                        }
                    }
                    GalerieAnzeige.KEINE_TREFFER -> GalerieHinweis {
                        // Die Kennzahlen meinen die ganze Sammlung — auch ohne Treffer.
                        if (stats != null) GalerieKennzahlen(stats)
                        LeerSymbol(Icons.Default.SearchOff)
                        Text(stringResource(R.string.gallery_no_results, searchInput), fontWeight = FontWeight.SemiBold)
                    }
                    GalerieAnzeige.LISTE -> LazyVerticalGrid(
                        columns = GridCells.Adaptive(160.dp),
                        state = gridState,
                        contentPadding = PaddingValues(Abstaende.mittel),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (stats != null) {
                            item(key = "gallery-stats", span = { GridItemSpan(maxLineSpan) }) {
                                GalerieKennzahlen(stats)
                            }
                        }
                        itemsIndexed(sets, key = { _, s -> s.setNumber }) { index, set ->
                            Bewegt {
                                SetCard(set, serverUrl, imageLoader, onSetClick, onDeleteSet, index,
                                    preis = preise[set.setNumber], waehrung = currency)
                            }
                        }
                        if (loadingMore) {
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
            }
        }

        // FAB overlay — bottom end of Box
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = Abstaende.gross, bottom = Abstaende.gross),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            SmallFloatingActionButton(
                onClick = onScanBarcode,
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                shape = Formen.leiste
            ) { Icon(Icons.Default.QrCodeScanner, stringResource(R.string.gallery_scan_barcode)) }
            FloatingActionButton(
                onClick = { showAddDialog = true },
                containerColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
                contentColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimary,
                shape = Formen.fab
            ) { Icon(Icons.Default.Add, stringResource(R.string.gallery_add_set)) }
        }
    }

    if (zeigeFilter) {
        GalerieFilterBlatt(
            members = householdMembers, konto = scopeMode, onKonto = onScopeChange,
            orte = lagerorte, lager = lagerModus, onLager = onLagerChange,
            themen = themes, thema = theme, onThema = onThemeChange,
            sortierung = sort, onSortierung = onSortChange,
            onSchliessen = { zeigeFilter = false },
        )
    }

    if (showAddDialog) {
        AddSetDialog(
            onDismiss = { showAddDialog = false },
            onAdd = { sn, qty, price, cond, owner, ort ->
                showAddDialog = false; onAddSet(sn, qty, price, cond, owner, ort) },
            householdMembers = householdMembers,
            defaultCondition = defaultCondition,
            lagerorte = lagerortVorrat,
            vorgabe = lagerState.vorgabe?.name ?: "",
        )
    }
}

/** Die Kennzahlen der Sammlung — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun GalerieKennzahlen(stats: DashboardStats) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        modifier = Modifier.fillMaxWidth()
    ) {
        // fmtInt() statt "%,d" mit anschliessendem Ersetzen des Kommas: Die
        // Webapp formatiert dieselben Kennzahlen mit toLocaleString(locale()).
        item { GalleryStatChip(fmtInt(stats.totalSets), stringResource(R.string.gallery_stat_sets)) }
        item { GalleryStatChip(fmtInt(stats.totalQuantity), stringResource(R.string.gallery_stat_units)) }
        item { GalleryStatChip(fmtInt(stats.totalParts), stringResource(R.string.gallery_stat_parts)) }
        // Minifiguren und Anleitungen nur, wenn es welche gibt: Ein Chip mit
        // einer Null ist eine Zahl ohne Aussage.
        if (stats.totalMinifigs > 0)
            item { GalleryStatChip(fmtInt(stats.totalMinifigs), stringResource(R.string.gallery_stat_minifigs)) }
        if (stats.totalInstructions > 0)
            item { GalleryStatChip(fmtInt(stats.totalInstructions), stringResource(R.string.gallery_stat_instructions)) }
    }
}

/**
 * Konto, Lagerort, Sortierung und Thema der Galerie. Angewandt wird jede Wahl
 * sofort auf dem Server; das Blatt bleibt offen, damit man mehrere setzen kann.
 */
@Composable
private fun GalerieFilterBlatt(
    members: List<ch.brickinventoryapp.data.model.HouseholdMember>, konto: String, onKonto: (String) -> Unit,
    orte: List<ch.brickinventoryapp.data.model.Lagerort>, lager: String, onLager: (String) -> Unit,
    themen: List<String>, thema: String, onThema: (String) -> Unit,
    sortierung: String, onSortierung: (String) -> Unit,
    onSchliessen: () -> Unit,
) {
    val vorgabe = ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT
    // Nur zurücksetzen, was abweicht: Jede Änderung lädt die Liste neu.
    val zuruecksetzen: () -> Unit = {
        if (Filterzahl.konto(members, konto) > 0) onKonto(ch.brickinventoryapp.data.ScopeFilter.ALL)
        if (Filterzahl.lager(orte, lager) > 0) onLager("")
        if (thema.isNotBlank()) onThema("")
        if (sortierung != vorgabe) onSortierung(vorgabe)
    }
    val aktiv = Filterzahl.galerie(members, konto, orte, lager, thema, sortierung)
    FilterBlattRahmen(onSchliessen = onSchliessen, onZuruecksetzen = zuruecksetzen.takeIf { aktiv > 0 }) {
        KontoFilterAbschnitt(members, konto, onKonto)
        LagerortFilterAbschnitt(orte, lager, onLager)
        FilterAbschnitt(stringResource(R.string.filter_section_sort)) {
            // Dieselben Werte wie SET_SORTS auf dem Server (utils/handlers.ts):
            // Einen unbekannten Wert setzte er still auf die Vorgabe zurück.
            listOf("added_desc", "added_asc", "name_asc", "num_asc",
                   "year_desc", "price_desc", "price_asc",
                   "qty_desc", "qty_asc").forEach { w ->
                FilterWahl(gallerySortLabel(w), sortierung == w) { if (sortierung != w) onSortierung(w) }
            }
        }
        if (themen.isNotEmpty()) {
            FilterAbschnitt(stringResource(R.string.catalog_filter_theme)) {
                FilterWahl(stringResource(R.string.gallery_all), thema.isEmpty()) { if (thema.isNotEmpty()) onThema("") }
                themen.forEach { t -> FilterWahl(t, thema == t) { onThema(if (thema == t) "" else t) } }
            }
        }
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

@Composable
fun GalleryStatChip(value: String, label: String) {
    Surface(
        shape = Formen.chip,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
        tonalElevation = 0.dp
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
        ) {
            Text(value, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(label, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetCard(
    set: SetItem,
    serverUrl: String,
    imageLoader: ImageLoader,
    onClick: (String) -> Unit,
    onDelete: (String) -> Unit,
    /** Position in der Kachelwand — nur fuer die Deckelfarbe des Designs "noppe". */
    position: Int = 0,
    /** Marktpreis und G&V; fehlt beides, steht der Kaufpreis da (wie im Web). */
    preis: KachelPreis? = null,
    waehrung: String = "EUR",
) {
    var showMenu by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val ctx = LocalContext.current
    // Vorschaubild über den Server, mit Rückfall auf die volle Auflösung, solange die
    // `_thumb`-Datei fehlt (nach einem CSV-Import erzeugt der Server sie nachträglich)
    // — wie data-orig in der Webapp; siehe util/ImageUrls.kt.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)

    // Einmaliger, verzögerter Wiederholversuch nach einem Ladefehler: Direkt nach dem
    // Erfassen ist das Bild auf dem Server oft noch nicht fertig, und Coil wiederholt
    // eine gescheiterte Anfrage nie von selbst. An Setnummer und Adresse gebunden,
    // damit eine wiederverwendete Kachel neu zählt; memoryCacheKeyExtra("retry", …)
    // macht die zweite Anfrage für Coil 3 zu einer anderen. Genau ein Versuch, damit
    // ein fehlendes Bild nicht in eine Schleife läuft.
    var retryNonce by remember(set.setNumber, imageUrl) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val isBrick = LocalIsBrickTheme.current
    val istNoppe = LocalIsNoppeTheme.current
    val istGlanz = LocalIstGlanz.current

    // Die Noppen stehen über der Karte: Eine Material-Card klippt auf ihre Form.
    // Deshalb rückt die Karte um die Noppenhöhe nach unten, und die Reihe wird daneben
    // gezeichnet und darübergelegt — wie `top:-6px` im CSS.
    Box {
        AppKarte(
            // Die Mindesthöhe gibt dem Bild Raum über den Etiketten; der Zuwachs geht an den
            // Bildbereich, die Textzeilen bleiben.
            modifier = Modifier.heightIn(min = 272.dp)
                .then(if (isBrick) Modifier.padding(top = NoppenMass.Stein.hoehe) else Modifier),
            onClick = { onClick(set.setNumber) }
        ) {
            Column {
                // Die Steinkante mit den Massen aus themes/brick.css (NoppenMass.Stein), wie im
                // Web über die ganze Breite. Nur die Kante liegt in der Karte; die Noppen werden
                // daneben gezeichnet, weil die Card sie abschnitte.
                if (isBrick) BrickStudCap(
                    mass = NoppenMass.Stein,
                    verlauf = SteinKantenVerlauf,
                )
                // Der Steindeckel des Designs "noppe" — Position modulo sechs,
                // genau wie `.sc:nth-child(6n+…)` in themes/noppe.css. Dieselbe
                // Bauform wie beim Stein-Design, nur hoeher und in wechselnder
                // Farbe; deshalb derselbe Baustein statt eines zweiten.
                if (istNoppe) BrickStudCap(color = steinTon(position), glanz = istGlanz)
                Box(Modifier.fillMaxWidth().height(if (isBrick) 142.dp else 170.dp)) {
                    if (imageUrl != null) {
                        AsyncImage(
                            model = ImageRequest.Builder(ctx).data(imageUrl)
                                .memoryCacheKeyExtra("retry", retryNonce.toString())
                                .crossfade(true).build(),
                            imageLoader = imageLoader,
                            contentDescription = set.name,
                            onState = { st ->
                                if (st is coil3.compose.AsyncImagePainter.State.Error && retryNonce == 0) {
                                    // Verzögert, nicht im selben Moment: Direkt nach
                                    // dem Erfassen erzeugt der Server die Vorschau
                                    // erst noch.
                                    scope.launch {
                                        kotlinx.coroutines.delay(1000)
                                        retryNonce = 1
                                    }
                                } else if (st is coil3.compose.AsyncImagePainter.State.Error) {
                                    // Auch der zweite Versuch scheiterte — jetzt auf
                                    // die volle Auflösung ausweichen (fehlende
                                    // _thumb-Datei ist der häufigste Grund).
                                    onImageError()
                                }
                            },
                            // Unten Platz für Zustands- und Besitzer-Etiketten, damit sie das Bild
                            // nicht verdecken; ContentScale.Fit rückt es nach oben statt es zu
                            // beschneiden.
                            modifier = Modifier.fillMaxSize().padding(bottom = 44.dp)
                                .then(if (isBrick) Modifier else Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))),
                            contentScale = ContentScale.Fit
                        )
                    } else {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Image(painterResource(R.drawable.ic_logo), null, Modifier.size(56.dp))
                        }
                    }
                    // Column statt Box: Eine Box stapelt, die Besitzer-Etiketten verdeckten die
                    // Zustandsplaketten. Untereinander bleibt beides lesbar.
                    Column(Modifier.align(Alignment.BottomStart).padding(6.dp),
                           verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                        ConditionBadges(set.conditions, set.condition)
                        // Wem gehört dieses Exemplar? Ohne die Angabe verschiebt
                        // man im Haushalt das falsche.
                        OwnerBadges(set.owners)
                    }
                    // Überlaufmenü oben rechts, wo Android es erwartet; die
                    // Mengenplakette bleibt in derselben Ecke, links davon.
                    Row(Modifier.align(Alignment.TopEnd).padding(Abstaende.haar),
                        verticalAlignment = Alignment.CenterVertically) {
                        if (set.quantity > 1) {
                            Surface(
                                color = MaterialTheme.colorScheme.primary,
                                shape = Formen.etikett,
                            ) {
                                Text(stringResource(R.string.gallery_quantity_badge, set.quantity), Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                            }
                        }
                        Box {
                            IconButton(onClick = { showMenu = true }) {
                                Icon(Icons.Default.MoreVert, stringResource(R.string.cd_set_menu), Modifier.size(20.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            DropdownMenu(showMenu, { showMenu = false }) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) },
                                    onClick = { showMenu = false; deleting = true },
                                    leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) }
                                )
                            }
                        }
                    }
                    // Die Spiegelung auf der Glasscheibe. ZULETZT im Box, damit sie
                    // ueber dem Bild liegt — und nur hier, nicht ueber der ganzen
                    // Kachel: Ein weisser Schleier ueber weissem Text ist kein
                    // Glanz, sondern Grau (siehe LichtStreifen in BrickDecor.kt).
                    if (istGlanz) Box(Modifier.matchParentSize().background(LichtStreifen))
                }
                Column(Modifier.padding(horizontal = 10.dp, vertical = Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                        lineHeight = 16.sp)
                    if (set.theme != null) Text(set.theme,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f), maxLines = 1)
                    if (set.pieces != null) Text(fmtInt(set.pieces) + stringResource(R.string.gallery_pieces_suffix),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val betrag = kachelBetrag(set, preis)
                    if (betrag != null) Row(verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        Text(fmtMoney(betrag, waehrung), style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                        val pct = preis?.pnlPct
                        if (pct != null) Text(fmtProzent(pct),
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                            color = if (pct >= 0) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        if (isBrick) NoppenReihe(
            mass = NoppenMass.Stein,
            modifier = Modifier.align(Alignment.TopStart),
            farbe = ch.brickinventoryapp.ui.theme.LocalSteinDekor.current.noppen,
        )
    }

    if (deleting) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text(stringResource(R.string.gallery_delete_title)) },
            text = { Text(stringResource(R.string.gallery_delete_text, set.name ?: set.setNumber)) },
            confirmButton = {
                TextButton(onClick = { deleting = false; onDelete(set.setNumber) }) {
                    Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text(stringResource(R.string.common_cancel)) } }
        )
    }
}

@Composable
fun AddSetDialog(
    onDismiss: () -> Unit,
    onAdd: (String, Int, Double?, String?, Int?, String?) -> Unit,
    defaultCondition: String = "N",
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /**
     * Der Ort, der schon dastehen soll (der Stern aus den Einstellungen); leer heisst
     * keine Vorgabe.
     */
    vorgabe: String = "",
) {
    var setNumber by rememberSaveable { mutableStateOf("") }
    var quantity  by rememberSaveable { mutableStateOf("1") }
    // Schlüssel ist die Vorgabe: Kommt sie erst nach dem Öffnen des Dialogs, übernimmt
    // das Feld sie; was jemand inzwischen getippt hat, bleibt, weil sich die Vorgabe
    // nur einmal ändert.
    var lagerort  by rememberSaveable(vorgabe) { mutableStateOf(vorgabe) }

    // ── Der Cursor steht sofort im Set-Feld ──
    //
    // LaunchedEffect(Unit) läuft einmal je Anzeige; die kurze Pause davor braucht es,
    // weil das Feld beim ersten Durchlauf noch nicht angeordnet ist und requestFocus()
    // sonst ins Leere liefe.
    val setFeldFokus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        try { setFeldFokus.requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
    }
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }
    val keyboard  = LocalSoftwareKeyboardController.current

    fun submit() {
        if (setNumber.isNotBlank()) {
            onAdd(setNumber, quantity.toIntOrNull() ?: 1,
                  purchasePrice.replace(',', '.').toDoubleOrNull(), condition,
                  // Ohne Haushalt gar nichts mitschicken — der Server bleibt
                  // dann beim eigenen Konto.
                  if (householdMembers.size > 1) owner else null,
                  lagerort.trim().takeIf { it.isNotEmpty() })
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text(stringResource(R.string.gallery_add_set_title), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OwnerPicker(householdMembers, owner, { owner = it })
                OutlinedTextField(
                    value = setNumber,
                    onValueChange = { setNumber = NumericInput.setNumber(it) },
                    label = { Text(stringResource(R.string.gallery_set_number)) },
                    placeholder = { Text(stringResource(R.string.gallery_set_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth().focusRequester(setFeldFokus), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    value = quantity,
                    onValueChange = { quantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.common_quantity)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    value = purchasePrice,
                    onValueChange = { purchasePrice = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.gallery_purchase_price)) },
                    placeholder = { Text(stringResource(R.string.common_unit_price_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.preisTastatur(),
                    keyboardActions = KeyboardActions(onDone = { keyboard?.hide(); submit() })
                )
                Zustandszeile(zustand = condition, onZustand = { condition = it })
                LagerortErfassung(lagerort, lagerorte, { lagerort = it })
            }
        },
        confirmButton = {
            Button(onClick = { submit() },
                enabled = setNumber.isNotBlank(), shape = Formen.knopf) { Text(stringResource(R.string.gallery_add)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
        shape = Formen.chip
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
