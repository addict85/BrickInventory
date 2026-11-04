package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.model.KennzahlenAnsicht
import ch.brickinventoryapp.ui.model.LagerortAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.model.SetAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsNoppeTheme
import ch.brickinventoryapp.ui.theme.LocalIstGlanz
import androidx.compose.foundation.shape.CircleShape
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
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.components.SortierMenue
import ch.brickinventoryapp.ui.components.ansagen

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
    // Das Set, dessen Detail daneben offen ist (breites Fenster); seine Kachel ist markiert.
    val gewaehlt = ch.brickinventoryapp.ui.components.LocalOffenesDetail.current
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

    val anzeige = galerieAnzeige(galerie, gefiltert = searchInput.isNotBlank() || theme.isNotEmpty())
    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SucheMitFilter).
    val gross = ch.brickinventoryapp.ui.components.grosseSchrift()
    val erfassenText = stringResource(R.string.gallery_add_set)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Suche und ein Knopf für alles andere: Konto, Lagerort, Thema und
            // Sortierung stehen im Blatt; die Kennzahlen rollen mit dem Raster. Scannen
            // sitzt daneben, damit unten nur EIN Knopf schwebt. Im Fehlerzustand nicht:
            // Ohne Sammlung gibt es nichts zu suchen.
            if (anzeige != GalerieAnzeige.FEHLER && anzeige != GalerieAnzeige.LEER) SucheMitFilter(
                wert = searchInput,
                onWert = { searchInput = it; onQueryChange(it) },
                platzhalter = stringResource(R.string.gallery_search_placeholder),
                aktiveFilter = Filterzahl.galerie(householdMembers, scopeMode, lagerorte, lagerModus, theme),
                onFilter = { zeigeFilter = true },
                onScannen = onScanBarcode,
                erfassen = erfassenText to { showAddDialog = true },
                sortierung = {
                    // Dieselben Werte wie SET_SORTS auf dem Server (utils/handlers.ts):
                    // Einen unbekannten Wert setzte er still auf die Vorgabe zurück.
                    SortierMenue(
                        optionen = listOf("added_desc", "added_asc", "name_asc", "num_asc",
                                          "year_desc", "price_desc", "price_asc",
                                          "qty_desc", "qty_asc").map { it to gallerySortLabel(it) },
                        gewaehlt = sort, onWahl = onSortChange,
                        vorgabe = ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT,
                    )
                },
            )

            ch.brickinventoryapp.ui.components.OfflineHinweis(galerie.offlineStand)
            // Der Kringel des Ziehens nur über einer Liste: Beim ersten Laden zeigt das
            // Skelett schon, dass etwas kommt, zwei Ladeanzeigen übereinander wirkten unruhig.
            PullToRefreshBox(isRefreshing = isLoading && anzeige == GalerieAnzeige.LISTE, onRefresh = onRefresh,
                             modifier = Modifier.fillMaxSize()) {
                when (anzeige) {
                    GalerieAnzeige.LAEDT -> SkelettRaster(ch.brickinventoryapp.ui.components.LesbareSpalten(160.dp), kachelHoehe = 252.dp,
                        kopfzeile = true, bildVerhaeltnis = BILD_SEITENVERHAELTNIS)
                    // Fehler und leere Sammlung sehen verschieden aus und bieten
                    // Verschiedenes an: hier den Grund und einen neuen Versuch.
                    GalerieAnzeige.FEHLER -> GalerieHinweis {
                        ch.brickinventoryapp.ui.components.FehlerHinweis(galerie.galleryFehler, onRefresh,
                            galerie.galleryFehlerKlasse)
                    }
                    GalerieAnzeige.LEER -> GalerieHinweis {
                        Image(painterResource(R.drawable.ic_logo), null, Modifier.size(64.dp))
                        Text(stringResource(R.string.gallery_no_sets), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.gallery_empty_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center)
                        // Derselbe Dialog wie der Plus-Knopf — kein zweiter Erfassungsweg.
                        ch.brickinventoryapp.ui.components.KnopfStapel {
                            Button(onClick = { showAddDialog = true }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.Add, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                                Spacer(Modifier.width(Abstaende.klein))
                                Text(stringResource(R.string.gallery_add_first))
                            }
                            OutlinedButton(onClick = onScanBarcode, modifier = Modifier.fillMaxWidth(), colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                                Icon(ch.brickinventoryapp.ui.components.BarcodeSymbol, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                                Spacer(Modifier.width(Abstaende.klein))
                                Text(stringResource(R.string.gallery_scan_barcode))
                            }
                        }
                    }
                    GalerieAnzeige.KEINE_TREFFER -> GalerieHinweis {
                        // Die Kennzahlen meinen die ganze Sammlung — auch ohne Treffer.
                        if (stats != null) GalerieKennzahlen(stats)
                        LeerSymbol(Icons.Default.SearchOff)
                        Text(stringResource(R.string.gallery_no_results, searchInput), fontWeight = FontWeight.SemiBold)
                    }
                    GalerieAnzeige.LISTE -> LazyVerticalGrid(
                        columns = ch.brickinventoryapp.ui.components.LesbareSpalten(160.dp),
                        state = gridState,
                        contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel, end = Abstaende.mittel,
                            bottom = ch.brickinventoryapp.ui.components.FabPlatz),
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
                                SetCard(set, serverUrl, imageLoader, onSetClick, index,
                                    preis = preise[set.setNumber], waehrung = currency,
                                    ausgewaehlt = set.setNumber == gewaehlt)
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

        // Erfassen erst, wenn die Sammlung da ist: Im Fehlerzustand gehört der Blick dem
        // Grund und dem „Erneut versuchen“, nicht einem Knopf, der ins Leere ginge.
        // Leer auch nicht: Die Leermeldung bietet Erfassen und Scannen selbst an.
        if (!gross && anzeige != GalerieAnzeige.FEHLER && anzeige != GalerieAnzeige.LEER) ch.brickinventoryapp.ui.components.ErfassenFab(
            erfassenText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (zeigeFilter) {
        GalerieFilterBlatt(
            members = householdMembers, konto = scopeMode, onKonto = onScopeChange,
            orte = lagerorte, lager = lagerModus, onLager = onLagerChange,
            themen = themes, thema = theme, onThema = onThemeChange,
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

/**
 * Die Kennzahlen der Sammlung — erste Zeile des Rasters, sie rollt mit. Bei grosser
 * Schrift wischbar, mit Verlauf und Pfeil am Rand (KennzahlenReihe): Umgebrochen
 * schoben fünf Kennzahlen das erste Set aus dem Blick.
 */
@Composable
private fun GalerieKennzahlen(stats: KennzahlenAnsicht) {
    KennzahlenReihe {
        // fmtInt() statt "%,d" mit anschliessendem Ersetzen des Kommas: Die
        // Webapp formatiert dieselben Kennzahlen mit toLocaleString(locale()).
        GalleryStatChip(fmtInt(stats.totalSets), stringResource(R.string.gallery_stat_sets))
        GalleryStatChip(fmtInt(stats.totalQuantity), stringResource(R.string.gallery_stat_units))
        GalleryStatChip(fmtInt(stats.totalParts), stringResource(R.string.gallery_stat_parts),
            teileAufschluesselung(stats.teileAusSets, stats.teileEinzeln))
        // Alle Kennzahlen immer, auch mit 0: Eine Reihe, deren Chips je nach Bestand
        // kommen und gehen, liest sich nicht gleich; 0 Figuren ist auch eine Auskunft.
        GalleryStatChip(fmtInt(stats.totalMinifigs), stringResource(R.string.gallery_stat_minifigs))
        GalleryStatChip(fmtInt(stats.totalInstructions), stringResource(R.string.gallery_stat_instructions))
    }
}

/**
 * Konto, Lagerort und Thema der Galerie. Angewandt wird jede Wahl sofort auf dem
 * Server; das Blatt bleibt offen, damit man mehrere setzen kann. Die Sortierung
 * hat ihr eigenes Menü neben dem Filterknopf.
 */
@Composable
private fun GalerieFilterBlatt(
    members: List<MitgliedAnsicht>, konto: String, onKonto: (String) -> Unit,
    orte: List<LagerortAnsicht>, lager: String, onLager: (String) -> Unit,
    themen: List<String>, thema: String, onThema: (String) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Nur zurücksetzen, was abweicht: Jede Änderung lädt die Liste neu.
    val zuruecksetzen: () -> Unit = {
        if (Filterzahl.konto(members, konto) > 0) onKonto(ch.brickinventoryapp.data.ScopeFilter.ALL)
        if (Filterzahl.lager(orte, lager) > 0) onLager("")
        if (thema.isNotBlank()) onThema("")
    }
    val aktiv = Filterzahl.galerie(members, konto, orte, lager, thema)
    FilterBlattRahmen(onSchliessen = onSchliessen, onZuruecksetzen = zuruecksetzen.takeIf { aktiv > 0 }) {
        KontoFilterAbschnitt(members, konto, onKonto)
        LagerortFilterAbschnitt(orte, lager, onLager)
        if (themen.isNotEmpty()) {
            FilterAbschnitt(stringResource(R.string.catalog_filter_theme)) {
                FilterWahl(stringResource(R.string.catalog_all_themes), thema.isEmpty()) { if (thema.isNotEmpty()) onThema("") }
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SetCard(
    set: SetAnsicht,
    serverUrl: String,
    imageLoader: ImageLoader,
    onClick: (String) -> Unit,
    /** Position in der Kachelwand — nur fuer die Deckelfarbe des Designs "noppe". */
    position: Int = 0,
    /** Marktpreis und G&V; fehlt beides, steht der Kaufpreis da (wie im Web). */
    preis: KachelPreis? = null,
    waehrung: String = "EUR",
    /** Steht das Detail dieses Sets daneben? Dann trägt die Kachel einen Rahmen. */
    ausgewaehlt: Boolean = false,
) {
    val ctx = LocalContext.current
    // Vorschaubild über den Server, mit Rückfall auf die volle Auflösung, solange die
    // `_thumb`-Datei fehlt (nach einem CSV-Import erzeugt der Server sie nachträglich)
    // — wie data-orig in der Webapp; siehe util/BildRueckfall.kt.
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
    // Im Design "farbfaecher" trägt jede Kachel den Ton ihres Themas als Streifen, wie
    // im Katalog. Die Galerie kennt nur den Namen; derselbe Name ergibt denselben Ton.
    val ton = if (ch.brickinventoryapp.ui.theme.LocalIsFarbfaecherTheme.current)
        ch.brickinventoryapp.ui.theme.faecherTon(set.theme?.hashCode()) else null

    // Ab grosser Schrift eine Listenzeile, Bild links und Text rechts, wie die Merkliste:
    // Über die volle Breite nahm das Bild zwei Drittel der Höhe, und es stand ein Set je
    // Bildschirm. Die Plaketten rücken dann vom Bild in den Text, das Bild ist zu klein.
    val zeile = ch.brickinventoryapp.ui.components.grosseSchrift()
    val pct = preis?.pnlPct
    val betrag = kachelBetrag(set, preis)
    val guv: (@Composable () -> Unit)? = if (pct != null && betrag != null) ({
            // G&V als Marke: In der Preiszeile brach sie neben „je Stück“ um, und die Kachel
            // wurde höher als ihre Nachbarin. Pfeil und Ansage „Gewinn …“: Eine nackte Zahl
            // sagte nur, wer die Finanzen kennt.
            val farbe = if (pct >= 0) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.error
            val ansage = stringResource(if (pct >= 0) R.string.gallery_pnl_gewinn else R.string.gallery_pnl_verlust,
                fmtProzent(pct))
            Surface(color = MaterialTheme.colorScheme.surface, shape = Formen.etikett) {
                Row(Modifier.padding(horizontal = Abstaende.winzig + Abstaende.haar, vertical = Abstaende.haar),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                    Icon(if (pct >= 0) Icons.AutoMirrored.Filled.TrendingUp else Icons.AutoMirrored.Filled.TrendingDown,
                        null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(12.dp)), tint = farbe)
                    Text(fmtProzent(pct), Modifier.semantics { contentDescription = ansage },
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                        color = farbe, maxLines = 1, softWrap = false)
                }
            }
    }) else null
    val menge: (@Composable () -> Unit)? = if (set.quantity > 1) ({
            Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.etikett) {
                Text(stringResource(R.string.gallery_quantity_badge, set.quantity), Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar),
                    color = MaterialTheme.colorScheme.onPrimary,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }
    }) else null
    // Weich einblenden nur, wenn Bewegung erwünscht ist (bewegungReduziert).
    val weich = !ch.brickinventoryapp.ui.components.bewegungReduziert()

    // Die Bildfläche; in der Zeile ohne Plaketten und links statt oben gerundet.
    val bildflaeche: @Composable (Modifier) -> Unit = { flaeche ->
        Box(flaeche) {
            ch.brickinventoryapp.ui.components.GemeinsamesBild(set.setNumber) { bild ->
                    ch.brickinventoryapp.ui.components.ProduktBild(
                    model = imageUrl?.let { ImageRequest.Builder(ctx).data(it)
                        .memoryCacheKeyExtra("retry", retryNonce.toString())
                        .crossfade(weich).build() },
                    imageLoader = imageLoader,
                    // Ohne Beschreibung: Die Kachel fasst ihren Inhalt zusammen, und der
                    // Name stand darunter schon als Text — TalkBack las ihn zweimal.
                    contentDescription = null,
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
                    // Randlos bis an die Kartenkanten: Der weisse Bildgrund nimmt die Fläche
                    // ein, die ContentScale.Fit neben dem Bild frei lässt.
                    modifier = bild
                        .fillMaxSize()
                        .then(when {
                            isBrick -> Modifier
                            zeile -> Modifier.clip(RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp))
                            else -> Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                        }),
                    contentScale = ContentScale.Fit,
                    ersatzGroesse = if (zeile) 32.dp else 48.dp,
                    bildgrund = true,
                    innenAbstand = Abstaende.klein,
                )
            }
            // Die Spiegelung auf der Glasscheibe: über dem Bild, aber UNTER Plaketten und
            // Menü, damit die Bedienelemente auf eigener Fläche stehen (lichtStreifen()).
            if (istGlanz) Box(Modifier.matchParentSize().background(ch.brickinventoryapp.ui.theme.lichtStreifen()))
            // Die Kachel trägt keine zerstörerische Aktion: Gelöscht wird im Detail,
            // mit Rückfrage und danach „Rückgängig“. Plaketten mit Abstand innerhalb
            // des Bilds (PLAKETTE_RAND): Auf dessen Rand sassen sie über der Ecke.
            if (!zeile) {
                if (guv != null) Box(Modifier.align(Alignment.TopStart).padding(PLAKETTE_RAND)) { guv() }
                if (menge != null) Box(Modifier.align(Alignment.TopEnd).padding(PLAKETTE_RAND)) { menge() }
            }
        }
    }

    // Zustand und Besitzer unter dem Bild statt darüber: Über dem Bild brauchten sie
    // einen freien Streifen, der als Lücke zwischen Bild und „Neu“ stand.
    val texte: @Composable (Modifier) -> Unit = { spalte ->
        Column(spalte.padding(horizontal = 10.dp, vertical = Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Column(Modifier.padding(bottom = Abstaende.haar), verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                // In der Zeile stehen die Plaketten vor dem Zustand in einer Reihe: Jede
                // eigene Zeile kostete bei 200 % ein Drittel der nächsten Zeile.
                if (zeile) FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.haar),
                ) {
                    guv?.invoke()
                    menge?.invoke()
                    ConditionBadges(set.conditions, set.condition)
                } else ConditionBadges(set.conditions, set.condition)
                // Wem gehört dieses Exemplar? Ohne die Angabe verschiebt
                // man im Haushalt das falsche.
                OwnerBadges(set.owners)
            }
            Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            // Im Raster zwei Zeilen, Thema und Preis immer: Kacheln einer Reihe sind dann
            // gleich hoch. Die Zeile muss niemandem gleichen und spart die Leerzeilen.
            Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                maxLines = 2, minLines = if (zeile) 1 else 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                lineHeight = 16.sp)
            // Thema und Teilezahl in einer Zeile: Getrennt stand meist eine davon leer.
            // Im Farbfächer ein Punkt im Ton der Kartenleiste davor: So liest sich die
            // Leiste als Thema, nicht nur als Farbe.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                if (ton != null && !set.theme.isNullOrBlank()) Box(Modifier.size(8.dp).background(ton, CircleShape))
                Text(themaUndTeile(set.theme, set.pieces?.let { fmtInt(it) + stringResource(R.string.gallery_pieces_suffix) }),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            // Wie im Web eine Zeile darüber, was der Betrag ist: Ohne Marktpreis ist es
            // der Kaufpreis (kachel_quelle), unbeschriftet las er sich als Marktwert.
            // Leer ohne Betrag, damit Kacheln einer Reihe gleich hoch bleiben; in der
            // Zeile steht die Bezeichnung vor dem Betrag, wenn die Breite reicht.
            val quelle = when (if (betrag != null) kachelQuelle(set, preis) else null) {
                KachelQuelle.MARKT -> stringResource(R.string.gallery_card_market)
                KachelQuelle.KAUF -> stringResource(R.string.gallery_card_paid)
                null -> ""
            }
            if (!zeile) Text(quelle, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            // FlowRow und je eine Zeile: Reicht die Breite nicht, rückt „je Stück“ unter
            // den Betrag, statt Zeichen für Zeichen umzubrechen.
            if (betrag != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                if (zeile) Text(quelle, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false,
                    modifier = Modifier.align(Alignment.CenterVertically))
                Text(fmtMoney(betrag, waehrung), style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
                    maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.align(Alignment.CenterVertically))
                // Der Betrag gilt je Stück; die Finanzen zeigen dasselbe Set mit dem Wert
                // aller Stück, und ohne Hinweis passten die Zahlen nicht zusammen.
                if (set.quantity > 1) Text(stringResource(R.string.gallery_price_each),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, softWrap = false, modifier = Modifier.align(Alignment.CenterVertically))
            } else if (!zeile) Text("", style = MaterialTheme.typography.labelMedium)
        }
    }

    // Die Noppen stehen über der Karte: Eine Material-Card klippt auf ihre Form.
    // Deshalb rückt die Karte um die Noppenhöhe nach unten, und die Reihe wird daneben
    // gezeichnet und darübergelegt — wie `top:-6px` im CSS.
    Box {
        AppKarte(
            modifier = Modifier
                .then(if (isBrick) Modifier.padding(top = NoppenMass.Stein.hoehe) else Modifier)
                .semantics { selected = ausgewaehlt }
                .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.karte) else Modifier),
            onClick = { onClick(set.setNumber) }
        ) {
            Column {
                // Die Steinkante mit den Massen aus themes/brick.css (NoppenMass.Stein), wie im
                // Web über die ganze Breite. Nur die Kante liegt in der Karte; die Noppen werden
                // daneben gezeichnet, weil die Card sie abschnitte.
                // Auf der schmalen Telefonkachel eine schlankere Kante: 22 dp nahmen dort dem Bild
                // sichtbar Platz; ab Tabletbreite die volle Höhe wie im Web.
                if (isBrick) BoxWithConstraints {
                    BrickStudCap(mass = NoppenMass.Stein, verlauf = SteinKantenVerlauf,
                        height = if (maxWidth < 240.dp) 12.dp else null)
                }
                // Der Steindeckel des Designs "noppe" — Position modulo sechs,
                // genau wie `.sc:nth-child(6n+…)` in themes/noppe.css. Dieselbe
                // Bauform wie beim Stein-Design, nur hoeher und in wechselnder
                // Farbe; deshalb derselbe Baustein statt eines zweiten.
                if (istNoppe) BrickStudCap(color = steinTon(position), glanz = istGlanz)
                if (ton != null) Box(Modifier.fillMaxWidth().height(5.dp).background(ton))
                // 4:3 wie die Setbilder selbst: Eine feste Höhe liess bei ContentScale.Fit
                // eine Lücke zwischen Bild und Text.
                if (zeile) Row(verticalAlignment = Alignment.Top) {
                    bildflaeche(Modifier.width(ZEILE_BILD_BREITE).aspectRatio(BILD_SEITENVERHAELTNIS))
                    texte(Modifier.weight(1f))
                } else {
                    bildflaeche(Modifier.fillMaxWidth().aspectRatio(BILD_SEITENVERHAELTNIS))
                    texte(Modifier)
                }
            }
        }
        if (isBrick) NoppenReihe(
            mass = NoppenMass.Stein,
            modifier = Modifier.align(Alignment.TopStart),
            farbe = ch.brickinventoryapp.ui.theme.LocalSteinDekor.current.noppen,
        )
    }
}

/** Breite des Vorschaubilds, wenn die Kachel bei grosser Schrift eine Listenzeile ist. */
private val ZEILE_BILD_BREITE = 96.dp

/** Seitenverhältnis der Bildfläche einer Kachel — das der Setbilder. */
private const val BILD_SEITENVERHAELTNIS = 4f / 3f

/** Plaketten auf dem Bild: Innenabstand des Bilds plus ein Rand, damit sie nicht auf seiner Ecke sitzen. */
private val PLAKETTE_RAND = Abstaende.klein + Abstaende.winzig

/** „Star Wars · 7’541 Teile“ — das Thema in der Hauptfarbe, die Teilezahl leiser. */
@Composable
private fun themaUndTeile(thema: String?, teile: String?): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        if (!thema.isNullOrBlank()) {
            pushStyle(androidx.compose.ui.text.SpanStyle(color = MaterialTheme.colorScheme.primary))
            append(thema)
            pop()
        }
        if (!thema.isNullOrBlank() && teile != null) append(" · ")
        if (teile != null) append(teile)
    }

@Composable
fun AddSetDialog(
    onDismiss: () -> Unit,
    onAdd: (String, Int, Double?, String?, Int?, String?) -> Unit,
    defaultCondition: String = "N",
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<MitgliedAnsicht> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /**
     * Der Ort, der schon dastehen soll (der Stern aus den Einstellungen); leer heisst
     * keine Vorgabe.
     */
    vorgabe: String = "",
    /** Nur Tests: Ein blinkender Cursor lässt Robolectric nie zur Ruhe kommen. */
    sofortFokus: Boolean = true,
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
    if (sofortFokus) LaunchedEffect(Unit) {
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
    // Hinzufügen bleibt antippbar und markiert dann das leere Feld: Grau ohne Grund liess
    // raten, warum nichts geschah.
    var nummerFehlt by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (setNumber.isBlank()) {
            nummerFehlt = true
            if (sofortFokus) try { setFeldFokus.requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
        } else {
            onAdd(setNumber, quantity.toIntOrNull() ?: 1,
                  purchasePrice.replace(',', '.').toDoubleOrNull(), condition,
                  // Ohne Haushalt gar nichts mitschicken — der Server bleibt
                  // dann beim eigenen Konto.
                  if (householdMembers.size > 1) owner else null,
                  lagerort.trim().takeIf { it.isNotEmpty() })
        }
    }

    // Derselbe Rahmen wie jede Erfassung (ErfassenDialog): Titel links, ohne Symbol.
    ch.brickinventoryapp.ui.components.ErfassenDialog(
        titel = stringResource(R.string.gallery_add_set_title),
        bestaetigen = stringResource(R.string.gallery_add),
        onBestaetigen = { submit() },
        onAbbrechen = onDismiss,
        // Ohne eigene Zeile „Bitte Set-Nummer eingeben“: Dreimal derselbe Hinweis schob bei
        // 200 % die Knöpfe aus dem Bild; was fehlt, sagt das Feld erst beim Tippen.
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        // Das Beispiel als Hilfetext wie im Merkposten-Dialog: Ein Platzhalter verschwand
        // mit dem Fokus, und der Dialog fokussiert das Feld sofort.
        OutlinedTextField(
            value = setNumber,
            onValueChange = { setNumber = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            isError = nummerFehlt && setNumber.isBlank(),
            supportingText = {
                if (nummerFehlt && setNumber.isBlank()) Text(stringResource(R.string.erfassen_nummer_fehlt), Modifier.ansagen())
                else Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            modifier = Modifier.fillMaxWidth().focusRequester(setFeldFokus), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.ganzzahlTastatur()
        )
        OutlinedTextField(
            value = quantity,
            onValueChange = { quantity = NumericInput.quantity(it) },
            label = { Text(stringResource(R.string.common_quantity)) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.ganzzahlTastatur()
        )
        OutlinedTextField(
            value = purchasePrice,
            onValueChange = { purchasePrice = NumericInput.price(it) },
            label = { Text(stringResource(R.string.gallery_purchase_price)) },
            placeholder = { Text(stringResource(R.string.common_unit_price_placeholder)) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.preisTastatur(),
            keyboardActions = KeyboardActions(onDone = { keyboard?.hide(); submit() })
        )
        Zustandszeile(zustand = condition, onZustand = { condition = it })
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
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
