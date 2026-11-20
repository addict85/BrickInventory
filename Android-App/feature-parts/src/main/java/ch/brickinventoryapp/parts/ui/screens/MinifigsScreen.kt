package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.parts.ui.MinifigsUiState
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.parts.ui.viewmodel.FigurenAktionen
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.state.ui.Filterzahl
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.shared.ui.ViewSection
import ch.brickinventoryapp.shared.ui.FilterSheetFrame
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.AccountFilterSection
import ch.brickinventoryapp.shared.ui.SearchWithFilter
import ch.brickinventoryapp.shared.ui.accountFilter
import ch.brickinventoryapp.model.domain.Figurenordnung
import ch.brickinventoryapp.ui.components.SortierMenu
import ch.brickinventoryapp.model.ui.ListView

/** Was der Figuren-Reiter zeigt; die Route sammelt es aus den Flüssen. */
internal data class FigurenZustand(
    val sitzung: PartsSessionUiState,
    val blick: ScopeUiState,
    val figuren: MinifigsUiState,
    val lager: LagerUiState,
)

/** Der Figuren-Reiter am Navigationsziel: reicht Zustand und Aktionen an [MinifigsScreen]. */
@Composable
fun MinifigsRoute(
    vm: MinifigsViewModel,
    imageLoader: ImageLoader,
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.sessionValues.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val figuren by vm.minifigsState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    MinifigsScreen(FigurenZustand(state, blick, figuren, storageState), vm, imageLoader, onOpenDetail, gridState)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun MinifigsScreen(
    zustand: FigurenZustand,
    aktionen: FigurenAktionen,
    imageLoader: ImageLoader,
    /** Öffnet die Detailansicht — nur der Graph kennt den NavController. */
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    /** Scroll-Zustand von aussen: Das Ziel wird beim Öffnen eines Details verworfen. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state = zustand.sitzung
    val blick = zustand.blick
    val partsState = zustand.figuren

    val figs = partsState.minifigs
    val minifigStats = partsState.minifigStats
    val isLoading = partsState.minifigsFetch.laedt
    val fehler = partsState.minifigsFetch as? Laden.Fehler
    val errorText = fehler?.meldung?.satz()
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: Zustand.NEU
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ScopeFilter.View.MINIFIGS]
        ?: ScopeFilter.ALL
    val manualFigs = partsState.manualFigs ?: emptyList()
    val storageState = zustand.lager
    // Die Figur, deren Detail daneben offen ist (breites Fenster); ihre Kachel ist markiert.
    val gewaehlt = LocalOpenDetail.current

    val onRefresh: () -> Unit = { aktionen.loadMinifigs() }
    val onScopeChange: (String) -> Unit = { aktionen.setScope(ScopeFilter.View.MINIFIGS, it) }
    // Der VORRAT an Lagerorten (nicht die belegten Orte): Beim Erfassen soll
    // auch ein leeres Regal zur Wahl stehen.
    val locationStock = storageState.eigene.map { it.name }

    // Suchtext aus dem Zustand, gefiltert wird auf dem Server — wie bei den Teilen und
    // in der Galerie, damit die Suchregel nur einmal existiert (Begründung in
    // PartsRepository.getMinifigs). remember(partsState.minifigsQuery): Das Feld hält
    // den Text beim Tippen selbst, übernimmt aber einen von aussen gesetzten (Leeren
    // beim Abmelden, Wiederherstellen).
    var search by remember(partsState.minifigsQuery) { mutableStateOf(partsState.minifigsQuery) }
    val ansicht = partsState.minifigsView
    var showAddDialog by rememberSaveable { mutableStateOf(false) }

    var showFilter by rememberSaveable { mutableStateOf(false) }

    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SearchWithFilter).
    val gross = largeFont()
    val addText = stringResource(R.string.minifigs_add)
    // Vorher stand der Fall „keine Treffer“ hinter derselben Bedingung wie „leer“
    // und war unerreichbar; ein Ladefehler sah aus wie eine leere Sammlung.
    val minifigsFiltered = search.isNotBlank() || Filterzahl.konto(householdMembers, scopeMode) > 0
    val anzeige = loadingIndicator(figs.isNotEmpty() || manualFigs.isNotEmpty(), isLoading, errorText, minifigsFiltered)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Suche und „Filter“: Konto und Ansicht stehen im Blatt, die Kennzahlen rollen mit
        // dem Raster. Im Fehlerzustand nicht — ohne Liste gibt es nichts zu suchen.
        if (anzeige != LoadingIndicator.FEHLER) SearchWithFilter(
            wert = search,
            onValue = { search = it; aktionen.setMinifigsQuery(it) },
            platzhalter = stringResource(R.string.minifigs_search_placeholder),
            activeFilter = Filterzahl.konto(householdMembers, scopeMode),
            onFilter = { showFilter = true },
            sorting = {
                SortierMenu(
                    optionen = Figurenordnung.entries.map { it to stringResource(it.beschriftung()) },
                    gewaehlt = partsState.order, onWahl = aktionen::setMinifigsOrder,
                    vorgabe = Figurenordnung.DEFAULT,
                )
            },
            erfassen = addText to { showAddDialog = true },
            aktive = listOfNotNull(accountFilter(householdMembers, scopeMode) { onScopeChange(ScopeFilter.ALL) }),
        )

        OfflineHint(partsState.minifigsOfflineStatus, onErneut = onRefresh)
        when (anzeige) {
            LoadingIndicator.LOADS ->
                SkeletonRaster(ReadableColumns(140.dp), kachelHoehe = 196.dp)
            LoadingIndicator.FEHLER -> StateHint { ErrorHint(errorText, onRefresh, fehler?.art) }
            // Wie der leere Teile-Reiter: Satz und Handlung, keine Kennzahlen neben „leer“.
            LoadingIndicator.LEER -> StateHint {
                HintText(Icons.Default.Person, stringResource(R.string.minifigs_none),
                    stringResource(R.string.minifigs_leer_text))
                Button(onClick = { showAddDialog = true }) { Text(addText) }
            }
            LoadingIndicator.NO_HITS -> StateHint {
                NoHitsHint(stringResource(R.string.minifigs_no_results))
                OutlinedButton(onClick = {
                    search = ""; aktionen.setMinifigsQuery("")
                    if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
                }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.search_clear_all)) }
            }
            LoadingIndicator.LISTE -> PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
                LazyVerticalGrid(
                    columns = ReadableColumns(140.dp),
                    state = gridState,
                    // Unten Platz für den Erfassen-Knopf, sonst verdeckt er die letzte Reihe.
                    contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                        end = Abstaende.mittel, bottom = FabSpace),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
                ) {
                    // Nach dem Inhalt gefragt, nicht nach der geladenen Seite: Die
                    // Zahlen meinen die ganze Sammlung, auch während einer Suche.
                    if (minifigStats.types > 0 || minifigStats.totalQuantity > 0) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "figs-stats") { MinifigsMetrics(minifigStats) }
                    }
                    // Manuelle Figuren als Grid-Sektion — eine durchgehende
                    // Scroll-Liste statt fixem Block über dem Grid (s. PartsScreen).
                    if (manualFigs.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.minifigs_manual_section))
                        }
                        items(manualFigs, key = { "manual-${it.id ?: it.figNumber}" }) { fig ->
                            Moved {
                                ManualFigTile(
                                    fig = fig,
                                    serverUrl = serverUrl,
                                    imageLoader = imageLoader,
                                    waehrung = waehrung,
                                    onEdit = { onOpenDetail(fig.figNumber) },
                                )
                            }
                        }
                        if (figs.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
                                SectionHeader(stringResource(R.string.minifigs_sets_section))
                            }
                        }
                    }
                    // Wie bei den Teilen: In der Tabellenansicht nimmt jede Zeile die ganze Breite,
                    // der Raster-Container bleibt derselbe. Die manuellen Figuren bleiben in beiden
                    // Ansichten Kacheln — wie #manual-figs-list in der Webapp, das nicht an
                    // figs-view hängt.
                    itemsIndexed(
                        figs,
                        key = { index, fig -> "${fig.figNumber}_${fig.source}_$index" },
                        span = { _, _ -> if (ansicht == ListView.TABLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { _, fig ->
                        // BEIDE Ansichten oeffnen denselben Dialog.
                        val oeffne = { aktionen.openSetItem(fig.figNumber) }
                        Moved {
                            if (ansicht == ListView.TABLE) MinifigTableRow(fig, serverUrl, imageLoader, oeffne)
                            else MinifigCard(fig, serverUrl, imageLoader, oeffne,
                                ausgewaehlt = gewaehlt == detailKey("fig", fig.figNumber))
                        }
                    }
                }
            }
        }
    }

        // Wie Galerie, Teile und Merkliste: kein „+“ im Fehlerzustand, leer steht es im Bild.
        if (!gross && anzeige != LoadingIndicator.FEHLER && anzeige != LoadingIndicator.LEER) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (showFilter) {
        val reset: () -> Unit = { onScopeChange(ScopeFilter.ALL) }
        FilterSheetFrame(
            onSchliessen = { showFilter = false },
            resetOn = reset.takeIf { Filterzahl.konto(householdMembers, scopeMode) > 0 },
        ) {
            AccountFilterSection(householdMembers, scopeMode, onScopeChange)
            ViewSection(ansicht) { aktionen.setMinifigsView(it) }
        }
    }

    if (showAddDialog) {
        AddMinifigDialog(
            householdMembers = householdMembers,
            defaultCondition = defaultCondition,
            onDismiss = { showAddDialog = false },
            lagerorte = locationStock,
            locationDefault = storageState.vorgabe?.name ?: "",
            onAdd = { erfassung ->
                showAddDialog = false
                aktionen.addMinifig(erfassung)
            }
        )
    }

    // Gelöscht wird im Detail (ManualItemDetailScreen, showDeleteConfirm) — an
    // derselben Stelle wie beim Set.
}

/** Die Kennzahlen der Minifiguren — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun MinifigsMetrics(minifigStats: MinifigsMetricsView) {
    MetricsSeries {
        // Zahlen vom Server (getMinifigStats): Aus der Liste gerechnet fehlten
        // die manuell erfassten Figuren, die hier ausgefiltert sind.
        GalleryStatChip(minifigStats.types, R.plurals.minifigs_stat_types)
        GalleryStatChip(minifigStats.totalQuantity, R.plurals.minifigs_stat_total)
        GalleryStatChip(minifigStats.manual, R.plurals.minifigs_stat_manual)
    }
}

private fun Figurenordnung.beschriftung(): Int = when (this) {
    Figurenordnung.NAME -> R.string.parts_ordnung_name
    Figurenordnung.NUMMER -> R.string.minifigs_ordnung_nummer
    Figurenordnung.QUANTITY -> R.string.parts_ordnung_menge
}
