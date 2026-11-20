package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.ColorPicker
import ch.brickinventoryapp.teile.ui.Teilefilter
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.teile.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.model.fach.PartsMetricsView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.teile.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.ui.components.SortierMenu
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.zustand.ui.ScopeUiState
import ch.brickinventoryapp.zustand.ui.Filterzahl
import ch.brickinventoryapp.zustand.ui.LagerUiState
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Moved
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.FabSpace
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.components.farbTranslator
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.gemeinsam.ui.GalleryStatChip
import ch.brickinventoryapp.gemeinsam.ui.MetricsSeries
import ch.brickinventoryapp.gemeinsam.ui.SearchWithFilter
import ch.brickinventoryapp.gemeinsam.ui.ActiveFilter
import ch.brickinventoryapp.gemeinsam.ui.accountFilter
import ch.brickinventoryapp.gemeinsam.ui.storageFilter
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.fach.LocationView
import ch.brickinventoryapp.model.fach.MemberView
import ch.brickinventoryapp.gemeinsam.ui.partsBreakdown
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.teile.ui.PartsSessionUiState

/** Was der Teile-Reiter zeigt; die Route sammelt es aus den Flüssen. */
internal data class TeileZustand(
    val state: PartsSessionUiState,
    val blick: ScopeUiState,
    val partsState: PartsUiState,
    val storageState: LagerUiState,
)

/** Der Teile-Reiter am Navigationsziel: reicht Zustand und Aktionen an [PartsScreen]. */
@Composable
fun PartsRoute(
    vm: PartsViewModel,
    imageLoader: ImageLoader,
    onOpenDetail: (partNumber: String, colorId: Int) -> Unit = { _, _ -> },
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val partsState by vm.teileState.collectAsStateWithLifecycle()
    val storageState by vm.storageState.collectAsStateWithLifecycle()
    PartsScreen(TeileZustand(state, blick, partsState, storageState), vm, imageLoader, onOpenDetail, gridState)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PartsScreen(
    zustand: TeileZustand,
    aktionen: TeileAktionen,
    imageLoader: ImageLoader,
    /**
     * Öffnet die Detailansicht eines manuell erfassten Teils. Bleibt Parameter,
     * weil nur der Navigationsgraph den NavController kennt.
     */
    onOpenDetail: (partNumber: String, colorId: Int) -> Unit = { _, _ -> },
    /**
     * Scroll-Zustand der Liste. Kommt von aussen, weil das Ziel beim Öffnen der
     * Detailansicht verlassen und danach neu zusammengesetzt wird — ein
     * `rememberLazyGridState()` hier drin würde zurückgesetzt, die Liste spränge nach
     * oben.
     */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state = zustand.state
    val blick = zustand.blick
    val partsState = zustand.partsState
    val storageState = zustand.storageState
    // Das Teil, dessen Detail daneben offen ist (breites Fenster); seine Kachel ist markiert.
    val gewaehlt = LocalOpenDetail.current

    val parts = partsState.parts
    val stats = partsState.partsStats
    val total = partsState.partsTotal
    val isLoading = partsState.partsFetch.laedt
    val fehler = partsState.partsFetch as? Laden.Fehler
    val errorText = fehler?.meldung?.satz()
    val currentPage = partsState.partsPage
    val colors = partsState.partsColors
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: Zustand.NEU
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ScopeFilter.View.PARTS]
        ?: ScopeFilter.ALL
    val manualParts = partsState.manualParts ?: emptyList()

    // Aktualisieren behält den Suchtext — sonst spränge die Liste auf den ganzen
    // Bestand, während das Feld den Text weiter zeigt. Wie in der Galerie (onRefresh =
    // loadSets()).
    val onRefresh: () -> Unit = { aktionen.loadParts() }
    val onSearch: (String) -> Unit = aktionen::setPartsQuery
    val onLoadMore: (Int) -> Unit = { aktionen.loadParts(page = it) }
    val onScopeChange: (String) -> Unit = { aktionen.setScope(ScopeFilter.View.PARTS, it) }
    val lagerorte = storageState.orte
    val storageMode = storageState.modi[ScopeFilter.View.PARTS] ?: ""
    val onStorageChange: (String) -> Unit = { aktionen.setStorageFilter(ScopeFilter.View.PARTS, it) }
    val ansicht = partsState.filter.ansicht
    // Der VORRAT an Lagerorten (nicht die belegten Orte): Beim Erfassen soll
    // auch ein leeres Regal zur Wahl stehen.
    val locationStock = storageState.eigene.map { it.name }

    // Das Feld zeigt, was im Zustand steht. `remember(...)` darauf geschlüsselt statt
    // `rememberSaveable`: Der Text lebt im ViewModel, und nach dem Zurücknavigieren
    // soll das Feld zum tatsächlichen Filter der Liste passen, nicht zu einem eigenen
    // Gedächtnis.
    var searchQuery by remember(partsState.filter.suche) { mutableStateOf(partsState.filter.suche) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    // Dedup nur neu berechnen, wenn sich die Daten aendern — nicht bei jeder Recomposition
    val distinctParts = remember(parts) { parts.distinctBy { "${it.partNumber}-${it.colorId}" } }
    val endReached by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= parts.size - 4 && parts.size < total && !isLoading
        }
    }
    LaunchedEffect(endReached) { if (endReached) onLoadMore(currentPage + 1) }

    var showFilter by rememberSaveable { mutableStateOf(false) }
    // Farbe und Kategorie — die beiden Filterlisten der Webapp (teile.js,
    // loadPartsFilters). Die Umrechnung auf die gemeinsame Form steht hier: Die beiden
    // Antworten tragen verschiedene Feldnamen, alles andere ist gleich.
    val farbe = farbTranslator()
    val farbEntries = remember(partsState.partsFilterColors, farbe) {
        partsState.partsFilterColors.mapNotNull { f ->
            f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                PartsFilterEntry(
                    wert = name, text = farbe(name), anzahl = f.uniqueParts,
                    farbe = colorFromHex(f.colorHex),
                )
            }
        }
    }
    val categoryText = categoryTranslator()
    val categoryEntries = remember(partsState.partsCategories, categoryText) {
        partsState.partsCategories.mapNotNull { k ->
            k.categoryName?.takeIf { it.isNotBlank() }?.let { wert ->
                PartsFilterEntry(wert = wert, text = categoryText(k.label ?: wert), anzahl = k.uniqueParts)
            }
        }
    }

    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SearchWithFilter).
    val gross = largeFont()
    val addText = stringResource(R.string.parts_add)
    // Suche und „Filter“: Konto, Lagerort, Ersatzteile, Farbe, Kategorie
    // und die Ansicht stehen im Blatt, die Kennzahlen rollen mit dem Raster.
    val partsFiltered = searchQuery.isNotBlank() || Filterzahl.teile(householdMembers, scopeMode, lagerorte,
        storageMode, partsState.filter.ersatz, partsState.filter.farbe, partsState.filter.kategorie) > 0
    val anzeige = loadingIndicator(parts.isNotEmpty() || manualParts.isNotEmpty(), isLoading, errorText, partsFiltered)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Im Fehlerzustand weder Suche noch Filter — ohne Liste gibt es nichts zu suchen.
        if (anzeige != LoadingIndicator.FEHLER) SearchWithFilter(
            wert = searchQuery,
            onValue = { searchQuery = it; onSearch(it) },
            platzhalter = stringResource(R.string.parts_search_placeholder),
            activeFilter = Filterzahl.teile(householdMembers, scopeMode, lagerorte, storageMode,
                partsState.filter.ersatz, partsState.filter.farbe, partsState.filter.kategorie),
            onFilter = { showFilter = true },
            sorting = { PartsSorting(partsState.filter.order, aktionen::setPartsOrder) },
            erfassen = addText to { showAddDialog = true },
            aktive = partsFilterChips(partsState, householdMembers, scopeMode, onScopeChange, lagerorte, storageMode,
                onStorageChange, farbEntries, categoryEntries, aktionen),
        )

        OfflineHint(partsState.partsOfflineStatus, onErneut = onRefresh)
        if (anzeige == LoadingIndicator.LOADS) {
            SkeletonRaster(ReadableColumns(120.dp), kachelHoehe = 164.dp, abstand = Abstaende.klein)
        } else if (anzeige == LoadingIndicator.FEHLER) {
            StateHint { ErrorHint(errorText, onRefresh, fehler?.art) }
        } else if (anzeige == LoadingIndicator.NO_HITS) {
            // Die Kennzahlen meinen die ganze Sammlung; ohne Treffer bleibt der Weg zurück.
            if (stats != null) Box(Modifier.padding(Abstaende.mittel)) { PartsMetrics(stats) }
            StateHint {
                NoHitsHint()
                OutlinedButton(onClick = {
                    searchQuery = ""; onSearch("")
                    if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
                    if (Filterzahl.lager(lagerorte, storageMode) > 0) onStorageChange("")
                    if (partsState.filter.ersatz != Ersatzteilwahl.ALLE) aktionen.setPartsSpare(Ersatzteilwahl.ALLE)
                    if (partsState.filter.farbe != ColorPicker.Alle) aktionen.setPartsColorFilter(ColorPicker.Alle)
                    if (partsState.filter.kategorie != Kategoriewahl.Alle) aktionen.setPartsCategoryFilter(Kategoriewahl.Alle)
                }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.search_clear_all)) }
            }
        } else if (anzeige == LoadingIndicator.LEER) {
            // Leer ohne Kennzahlen: „82 Stück“ neben „Keine Teile“ widersprach sich.
            StateHint {
                HintText(ImageVector.vectorResource(R.drawable.ic_parts_bricks), stringResource(R.string.parts_none),
                    stringResource(R.string.parts_leer_text))
                Button(onClick = { showAddDialog = true }) { Text(addText) }
            }
        } else {
            PullToRefreshBox(isRefreshing = isLoading && parts.isNotEmpty(), onRefresh = onRefresh) {
                LazyVerticalGrid(
                    state = gridState,
                    columns = ReadableColumns(120.dp),
                    // Unten Platz für den Erfassen-Knopf, sonst verdeckt er die letzte Reihe.
                    contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                        end = Abstaende.mittel, bottom = FabSpace),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
                ) {
                    if (stats != null) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "parts-stats") { PartsMetrics(stats) }
                    }
                    // Manuell erfasste Teile als Grid-Sektion statt in einer FlowRow über dem Grid:
                    // So scrollt alles als eine Liste, nicht nur der Set-Teil.
                    if (manualParts.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.parts_manual_section))
                        }
                        items(manualParts, key = { "manual-${it.id ?: "${it.partNumber}-${it.colorId}"}" }) { part ->
                            Moved {
                                ManualPartTile(
                                    part = part,
                                    serverUrl = serverUrl,
                                    imageLoader = imageLoader,
                                    waehrung = waehrung,
                                    onEdit = { onOpenDetail(part.partNumber, part.colorId) },
                                )
                            }
                        }
                        if (distinctParts.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
                                SectionHeader(stringResource(R.string.parts_sets_section))
                            }
                        }
                    }
                    // In der Tabellenansicht nimmt jede Zeile die ganze Breite (span =
                    // maxLineSpan). Derselbe Raster-Container, sonst wären Scrollstand,
                    // Endlos-Nachladen und die manuelle Sektion doppelt zu pflegen. Die manuellen
                    // Einträge bleiben in beiden Ansichten Kacheln, wie in der Webapp
                    // (#manual-parts-list hängt nicht an parts-view).
                    items(
                        distinctParts,
                        key = { "${it.partNumber}-${it.colorId}" },
                        span = { if (ansicht == ListView.TABLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { part ->
                        // BEIDE Ansichten oeffnen denselben Dialog — eine
                        // Ansicht darf nicht koennen, was die andere nicht kann.
                        val oeffne = { aktionen.openSetItem(part.partNumber, part.colorId) }
                        Moved {
                            if (ansicht == ListView.TABLE) PartTableRow(part, serverUrl, imageLoader, oeffne)
                            else PartCard(part, serverUrl, imageLoader, oeffne,
                                ausgewaehlt = gewaehlt == detailKey("part", part.partNumber, part.colorId))
                        }
                    }
                    if (isLoading) {
                        // Fester Schlüssel wie bei den Kopfzeilen darüber — Begründung in
                        // GalleryScreen.kt.
                        item(key = "parts-loading-more", span = { GridItemSpan(maxLineSpan) }) {
                            Box(Modifier.fillMaxWidth().padding(Abstaende.gross), Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(24.dp))
                            }
                        }
                    }
                }
            }
        }
    }

        // Eine Regel für alle Reiter (wie Galerie und Merkliste): Kein „+“ im Fehlerzustand,
        // und leer steht der Knopf schon mitten im Bild.
        if (!gross && anzeige != LoadingIndicator.FEHLER && anzeige != LoadingIndicator.LEER) AddFab(
            addText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (showFilter) {
        TeileFilterBlatt(
            aktionen = aktionen,
            partsState = partsState,
            householdMembers = householdMembers,
            scopeMode = scopeMode,
            onScopeChange = onScopeChange,
            lagerorte = lagerorte,
            storageMode = storageMode,
            onStorageChange = onStorageChange,
            farbEntries = farbEntries,
            categoryEntries = categoryEntries,
            onSchliessen = { showFilter = false },
        )
    }

    if (showAddDialog) {
        AddPartDialog(
            householdMembers = householdMembers,
            colors = colors,
            onDismiss = { showAddDialog = false },
            lagerorte = locationStock,
            locationDefault = storageState.vorgabe?.name ?: "",
            onAdd = { erfassung ->
                showAddDialog = false
                aktionen.addPart(erfassung)
            },
            defaultCondition = defaultCondition
        )
    }

    // Gelöscht wird im Detail (ManualItemDetailScreen, showDeleteConfirm), nicht auf
    // der Kachel.
}

/** Die Kennzahlen der Teile — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun PartsMetrics(stats: PartsMetricsView) {
    MetricsSeries {
        GalleryStatChip(stats.uniqueParts, R.plurals.parts_stat_types)
        GalleryStatChip(stats.uniqueColors, R.plurals.parts_stat_colors)
        GalleryStatChip(stats.teileGesamt, R.plurals.parts_stat_total,
            partsBreakdown(stats.partsFromSets, stats.partsSingle))
    }
}

/** Die Reihenfolgen der Webapp (parts-ordnung), in derselben Bauform wie Galerie und Merkliste. */
@Composable
private fun PartsSorting(gewaehlt: Teilefilter.Order, onWahl: (Teilefilter.Order) -> Unit) {
    SortierMenu(
        optionen = Teilefilter.Order.entries.map { it to stringResource(it.beschriftung()) },
        gewaehlt = gewaehlt, onWahl = onWahl,
        vorgabe = Teilefilter.Order.FARBE,
    )
}

private fun Teilefilter.Order.beschriftung(): Int = when (this) {
    Teilefilter.Order.FARBE -> R.string.parts_ordnung_farbe
    Teilefilter.Order.NAME -> R.string.parts_ordnung_name
    Teilefilter.Order.QUANTITY -> R.string.parts_ordnung_menge
}

/** Die wirkenden Filter der Teile als Chips; jeder fällt einzeln weg, wie im Blatt. */
@Composable
private fun partsFilterChips(
    partsState: PartsUiState,
    members: List<MemberView>,
    konto: String,
    onAccount: (String) -> Unit,
    orte: List<LocationView>,
    lager: String,
    onStorage: (String) -> Unit,
    farben: List<PartsFilterEntry>,
    kategorien: List<PartsFilterEntry>,
    aktionen: TeileAktionen,
): List<ActiveFilter> {
    val f = partsState.filter
    val ersatz = when (f.ersatz) {
        Ersatzteilwahl.ALLE -> null
        Ersatzteilwahl.OHNE -> R.string.parts_filter_no_spare
        Ersatzteilwahl.NUR -> R.string.parts_filter_spare
    }?.let { ActiveFilter(stringResource(it)) { aktionen.setPartsSpare(Ersatzteilwahl.ALLE) } }
    return listOfNotNull(
        accountFilter(members, konto) { onAccount(ScopeFilter.ALL) },
        storageFilter(orte, lager) { onStorage("") },
        ersatz,
        f.farbe.wert?.let { w -> ActiveFilter(farben.firstOrNull { it.wert == w }?.text ?: w) {
            aktionen.setPartsColorFilter(ColorPicker.Alle) } },
        f.kategorie.wert?.let { w -> ActiveFilter(kategorien.firstOrNull { it.wert == w }?.text ?: w) {
            aktionen.setPartsCategoryFilter(Kategoriewahl.Alle) } },
    )
}
