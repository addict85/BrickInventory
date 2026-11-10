package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.theme.farbeAusHex
import ch.brickinventoryapp.teile.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.model.ui.model.TeileKennzahlenAnsicht
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
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.ZustandsHinweis
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.ErfassenFab
import ch.brickinventoryapp.ui.components.FabPlatz
import ch.brickinventoryapp.ui.components.LesbareSpalten
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.OfflineHinweis
import ch.brickinventoryapp.ui.components.detailSchluessel
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.kategorieUebersetzer
import ch.brickinventoryapp.gemeinsam.ui.GalleryStatChip
import ch.brickinventoryapp.gemeinsam.ui.KennzahlenReihe
import ch.brickinventoryapp.gemeinsam.ui.SucheMitFilter
import ch.brickinventoryapp.gemeinsam.ui.teileAufschluesselung
import ch.brickinventoryapp.model.ui.Listenansicht
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.teile.ui.TeileSitzungUiState

/** Was der Teile- und der Figurenreiter zeigen; die Routen sammeln es aus den Flüssen. */
internal data class TeileZustand(
    val state: TeileSitzungUiState,
    val blick: BlickfeldUiState,
    val partsState: PartsUiState,
    val lagerState: LagerUiState,
)

/** Der Teile-Reiter am Navigationsziel: reicht Zustand und Aktionen an [PartsScreen]. */
@Composable
fun PartsRoute(
    vm: TeileViewModel,
    imageLoader: ImageLoader,
    onOpenDetail: (partNumber: String, colorId: Int) -> Unit = { _, _ -> },
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()
    val lagerState by vm.lagerState.collectAsStateWithLifecycle()
    PartsScreen(TeileZustand(state, blick, partsState, lagerState), vm, imageLoader, onOpenDetail, gridState)
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
    val lagerState = zustand.lagerState
    // Das Teil, dessen Detail daneben offen ist (breites Fenster); seine Kachel ist markiert.
    val gewaehlt = LocalOffenesDetail.current

    val parts = partsState.parts
    val stats = partsState.partsStats
    val total = partsState.partsTotal
    val isLoading = partsState.partsLoading
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
    val lagerorte = lagerState.orte
    val lagerModus = lagerState.modi[ScopeFilter.View.PARTS] ?: ""
    val onLagerChange: (String) -> Unit = { aktionen.setLagerFilter(ScopeFilter.View.PARTS, it) }
    val ansicht = partsState.partsView
    // Der VORRAT an Lagerorten (nicht die belegten Orte): Beim Erfassen soll
    // auch ein leeres Regal zur Wahl stehen.
    val lagerortVorrat = lagerState.eigene.map { it.name }

    // Das Feld zeigt, was im Zustand steht. `remember(...)` darauf geschlüsselt statt
    // `rememberSaveable`: Der Text lebt im ViewModel, und nach dem Zurücknavigieren
    // soll das Feld zum tatsächlichen Filter der Liste passen, nicht zu einem eigenen
    // Gedächtnis.
    var searchQuery by remember(partsState.partsQuery) { mutableStateOf(partsState.partsQuery) }
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

    var zeigeFilter by rememberSaveable { mutableStateOf(false) }
    // Farbe und Kategorie — die beiden Filterlisten der Webapp (03-parts.js,
    // loadPartsFilters). Die Umrechnung auf die gemeinsame Form steht hier: Die beiden
    // Antworten tragen verschiedene Feldnamen, alles andere ist gleich.
    val farbe = farbUebersetzer()
    val farbEintraege = remember(partsState.partsFilterColors, farbe) {
        partsState.partsFilterColors.mapNotNull { f ->
            f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                TeileFilterEintrag(
                    wert = name, text = farbe(name), anzahl = f.uniqueParts,
                    farbe = farbeAusHex(f.colorHex),
                )
            }
        }
    }
    val kategorieText = kategorieUebersetzer()
    val kategorieEintraege = remember(partsState.partsCategories, kategorieText) {
        partsState.partsCategories.mapNotNull { k ->
            k.categoryName?.takeIf { it.isNotBlank() }?.let { wert ->
                TeileFilterEintrag(wert = wert, text = kategorieText(k.label ?: wert), anzahl = k.uniqueParts)
            }
        }
    }

    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SucheMitFilter).
    val gross = grosseSchrift()
    val erfassenText = stringResource(R.string.parts_add)
    // Suche und „Filter“: Konto, Lagerort, Ersatzteile, Farbe, Kategorie
    // und die Ansicht stehen im Blatt, die Kennzahlen rollen mit dem Raster.
    val teileGefiltert = searchQuery.isNotBlank() || Filterzahl.teile(householdMembers, scopeMode, lagerorte,
        lagerModus, partsState.partsSpare, partsState.partsColorFilter, partsState.partsCategoryFilter) > 0
    val anzeige = ladeanzeige(parts.isNotEmpty() || manualParts.isNotEmpty(), isLoading, partsState.partsFehler, teileGefiltert)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Im Fehlerzustand weder Suche noch Filter — ohne Liste gibt es nichts zu suchen.
        if (anzeige != Ladeanzeige.FEHLER) SucheMitFilter(
            wert = searchQuery,
            onWert = { searchQuery = it; onSearch(it) },
            platzhalter = stringResource(R.string.parts_search_placeholder),
            aktiveFilter = Filterzahl.teile(householdMembers, scopeMode, lagerorte, lagerModus,
                partsState.partsSpare, partsState.partsColorFilter, partsState.partsCategoryFilter),
            onFilter = { zeigeFilter = true },
            erfassen = erfassenText to { showAddDialog = true },
        )

        OfflineHinweis(partsState.teileOfflineStand)
        if (anzeige == Ladeanzeige.LAEDT) {
            SkelettRaster(LesbareSpalten(120.dp), kachelHoehe = 164.dp, abstand = Abstaende.klein)
        } else if (anzeige == Ladeanzeige.FEHLER) {
            ZustandsHinweis { FehlerHinweis(partsState.partsFehler, onRefresh, partsState.partsFehlerKlasse) }
        } else if (anzeige == Ladeanzeige.KEINE_TREFFER) {
            // Die Kennzahlen meinen die ganze Sammlung; ohne Treffer bleibt der Weg zurück.
            if (stats != null) Box(Modifier.padding(Abstaende.mittel)) { TeileKennzahlen(stats) }
            ZustandsHinweis {
                KeinTrefferHinweis()
                OutlinedButton(onClick = {
                    searchQuery = ""; onSearch("")
                    if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
                    if (Filterzahl.lager(lagerorte, lagerModus) > 0) onLagerChange("")
                    if (partsState.partsSpare != Ersatzteilwahl.ALLE) aktionen.setPartsSpare(Ersatzteilwahl.ALLE)
                    if (partsState.partsColorFilter.isNotBlank()) aktionen.setPartsColorFilter("")
                    if (partsState.partsCategoryFilter.isNotBlank()) aktionen.setPartsCategoryFilter("")
                }) { Text(stringResource(R.string.search_clear_all)) }
            }
        } else if (anzeige == Ladeanzeige.LEER) {
            // Leer ohne Kennzahlen: „82 Stück“ neben „Keine Teile“ widersprach sich.
            ZustandsHinweis {
                HinweisText(ImageVector.vectorResource(R.drawable.ic_parts_bricks), stringResource(R.string.parts_none),
                    stringResource(R.string.parts_leer_text))
                Button(onClick = { showAddDialog = true }) { Text(erfassenText) }
            }
        } else {
            PullToRefreshBox(isRefreshing = isLoading && parts.isNotEmpty(), onRefresh = onRefresh) {
                LazyVerticalGrid(
                    state = gridState,
                    columns = LesbareSpalten(120.dp),
                    // Unten Platz für den Erfassen-Knopf, sonst verdeckt er die letzte Reihe.
                    contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                        end = Abstaende.mittel, bottom = FabPlatz),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
                ) {
                    if (stats != null) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "parts-stats") { TeileKennzahlen(stats) }
                    }
                    // Manuell erfasste Teile als Grid-Sektion statt in einer FlowRow über dem Grid:
                    // So scrollt alles als eine Liste, nicht nur der Set-Teil.
                    if (manualParts.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.parts_manual_section))
                        }
                        items(manualParts, key = { "manual-${it.id ?: "${it.partNumber}-${it.colorId}"}" }) { part ->
                            Bewegt {
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
                        span = { if (ansicht == Listenansicht.TABELLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { part ->
                        // BEIDE Ansichten oeffnen denselben Dialog — eine
                        // Ansicht darf nicht koennen, was die andere nicht kann.
                        val oeffne = { aktionen.oeffneSetItem(Postenart.PART, part.partNumber, part.colorId) }
                        Bewegt {
                            if (ansicht == Listenansicht.TABELLE) PartTableRow(part, serverUrl, imageLoader, oeffne)
                            else PartCard(part, serverUrl, imageLoader, oeffne,
                                ausgewaehlt = gewaehlt == detailSchluessel("part", part.partNumber, part.colorId))
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
        if (!gross && anzeige != Ladeanzeige.FEHLER && anzeige != Ladeanzeige.LEER) ErfassenFab(
            erfassenText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (zeigeFilter) {
        TeileFilterBlatt(
            aktionen = aktionen,
            partsState = partsState,
            householdMembers = householdMembers,
            scopeMode = scopeMode,
            onScopeChange = onScopeChange,
            lagerorte = lagerorte,
            lagerModus = lagerModus,
            onLagerChange = onLagerChange,
            farbEintraege = farbEintraege,
            kategorieEintraege = kategorieEintraege,
            onSchliessen = { zeigeFilter = false },
        )
    }

    if (showAddDialog) {
        AddPartDialog(
            householdMembers = householdMembers,
            colors = colors,
            onDismiss = { showAddDialog = false },
            lagerorte = lagerortVorrat,
            lagerortVorgabe = lagerState.vorgabe?.name ?: "",
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
private fun TeileKennzahlen(stats: TeileKennzahlenAnsicht) {
    KennzahlenReihe {
        GalleryStatChip(stats.uniqueParts, R.plurals.parts_stat_types)
        GalleryStatChip(stats.uniqueColors, R.plurals.parts_stat_colors)
        GalleryStatChip(stats.teileGesamt, R.plurals.parts_stat_total,
            teileAufschluesselung(stats.teileAusSets, stats.teileEinzeln))
    }
}
