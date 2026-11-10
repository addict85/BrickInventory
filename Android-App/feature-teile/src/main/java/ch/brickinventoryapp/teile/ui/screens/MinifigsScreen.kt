package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.teile.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.model.ui.model.FigurenKennzahlenAnsicht
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.ZustandsHinweis
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.ErfassenFab
import ch.brickinventoryapp.ui.components.FabPlatz
import ch.brickinventoryapp.ui.components.LesbareSpalten
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.OfflineHinweis
import ch.brickinventoryapp.ui.components.detailSchluessel
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.gemeinsam.ui.AnsichtAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.FilterBlattRahmen
import ch.brickinventoryapp.gemeinsam.ui.GalleryStatChip
import ch.brickinventoryapp.gemeinsam.ui.KennzahlenReihe
import ch.brickinventoryapp.gemeinsam.ui.KontoFilterAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.SucheMitFilter
import ch.brickinventoryapp.model.ui.Listenansicht

/** Der Figuren-Reiter am Navigationsziel: reicht Zustand und Aktionen an [MinifigsScreen]. */
@Composable
fun MinifigsRoute(
    vm: TeileViewModel,
    imageLoader: ImageLoader,
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()
    val lagerState by vm.lagerState.collectAsStateWithLifecycle()
    MinifigsScreen(TeileZustand(state, blick, partsState, lagerState), vm, imageLoader, onOpenDetail, gridState)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MinifigsScreen(
    zustand: TeileZustand,
    aktionen: TeileAktionen,
    imageLoader: ImageLoader,
    /** Öffnet die Detailansicht — nur der Graph kennt den NavController. */
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    /** Scroll-Zustand von aussen: Das Ziel wird beim Öffnen eines Details verworfen. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    val state = zustand.state
    val blick = zustand.blick
    val partsState = zustand.partsState

    val figs = partsState.minifigs
    val minifigStats = partsState.minifigStats
    val isLoading = partsState.minifigsLoading
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: Zustand.NEU
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ScopeFilter.View.MINIFIGS]
        ?: ScopeFilter.ALL
    val manualFigs = partsState.manualFigs ?: emptyList()
    val lagerState = zustand.lagerState
    // Die Figur, deren Detail daneben offen ist (breites Fenster); ihre Kachel ist markiert.
    val gewaehlt = LocalOffenesDetail.current

    val onRefresh: () -> Unit = { aktionen.loadMinifigs() }
    val onScopeChange: (String) -> Unit = { aktionen.setScope(ScopeFilter.View.MINIFIGS, it) }
    // Der VORRAT an Lagerorten (nicht die belegten Orte): Beim Erfassen soll
    // auch ein leeres Regal zur Wahl stehen.
    val lagerortVorrat = lagerState.eigene.map { it.name }

    // Suchtext aus dem Zustand, gefiltert wird auf dem Server — wie bei den Teilen und
    // in der Galerie, damit die Suchregel nur einmal existiert (Begründung in
    // TeileRepository.getMinifigs). remember(partsState.minifigsQuery): Das Feld hält
    // den Text beim Tippen selbst, übernimmt aber einen von aussen gesetzten (Leeren
    // beim Abmelden, Wiederherstellen).
    var search by remember(partsState.minifigsQuery) { mutableStateOf(partsState.minifigsQuery) }
    val ansicht = partsState.minifigsView
    var showAddDialog by rememberSaveable { mutableStateOf(false) }

    var zeigeFilter by rememberSaveable { mutableStateOf(false) }

    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SucheMitFilter).
    val gross = grosseSchrift()
    val erfassenText = stringResource(R.string.minifigs_add)
    // Vorher stand der Fall „keine Treffer“ hinter derselben Bedingung wie „leer“
    // und war unerreichbar; ein Ladefehler sah aus wie eine leere Sammlung.
    val figurenGefiltert = search.isNotBlank() || Filterzahl.konto(householdMembers, scopeMode) > 0
    val anzeige = ladeanzeige(figs.isNotEmpty() || manualFigs.isNotEmpty(), isLoading, partsState.minifigsFehler, figurenGefiltert)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Suche und „Filter“: Konto und Ansicht stehen im Blatt, die Kennzahlen rollen mit
        // dem Raster. Im Fehlerzustand nicht — ohne Liste gibt es nichts zu suchen.
        if (anzeige != Ladeanzeige.FEHLER) SucheMitFilter(
            wert = search,
            onWert = { search = it; aktionen.setMinifigsQuery(it) },
            platzhalter = stringResource(R.string.minifigs_search_placeholder),
            aktiveFilter = Filterzahl.konto(householdMembers, scopeMode),
            onFilter = { zeigeFilter = true },
            erfassen = erfassenText to { showAddDialog = true },
        )

        OfflineHinweis(partsState.figurenOfflineStand)
        when (anzeige) {
            Ladeanzeige.LAEDT ->
                SkelettRaster(LesbareSpalten(140.dp), kachelHoehe = 196.dp)
            Ladeanzeige.FEHLER -> ZustandsHinweis { FehlerHinweis(partsState.minifigsFehler, onRefresh, partsState.minifigsFehlerKlasse) }
            // Wie der leere Teile-Reiter: Satz und Handlung, keine Kennzahlen neben „leer“.
            Ladeanzeige.LEER -> ZustandsHinweis {
                HinweisText(Icons.Default.Person, stringResource(R.string.minifigs_none),
                    stringResource(R.string.minifigs_leer_text))
                Button(onClick = { showAddDialog = true }) { Text(erfassenText) }
            }
            Ladeanzeige.KEINE_TREFFER -> ZustandsHinweis {
                KeinTrefferHinweis(stringResource(R.string.minifigs_no_results))
                OutlinedButton(onClick = {
                    search = ""; aktionen.setMinifigsQuery("")
                    if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
                }) { Text(stringResource(R.string.search_clear_all)) }
            }
            Ladeanzeige.LISTE -> PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
                LazyVerticalGrid(
                    columns = LesbareSpalten(140.dp),
                    state = gridState,
                    // Unten Platz für den Erfassen-Knopf, sonst verdeckt er die letzte Reihe.
                    contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                        end = Abstaende.mittel, bottom = FabPlatz),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Nach dem Inhalt gefragt, nicht nach der geladenen Seite: Die
                    // Zahlen meinen die ganze Sammlung, auch während einer Suche.
                    if (minifigStats.types > 0 || minifigStats.totalQuantity > 0) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "figs-stats") { FigurenKennzahlen(minifigStats) }
                    }
                    // Manuelle Figuren als Grid-Sektion — eine durchgehende
                    // Scroll-Liste statt fixem Block über dem Grid (s. PartsScreen).
                    if (manualFigs.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.minifigs_manual_section))
                        }
                        items(manualFigs, key = { "manual-${it.id ?: it.figNumber}" }) { fig ->
                            Bewegt {
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
                        span = { _, _ -> if (ansicht == Listenansicht.TABELLE) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { _, fig ->
                        // BEIDE Ansichten oeffnen denselben Dialog.
                        val oeffne = { aktionen.oeffneSetItem(Postenart.FIG, fig.figNumber) }
                        Bewegt {
                            if (ansicht == Listenansicht.TABELLE) MinifigTableRow(fig, serverUrl, imageLoader, oeffne)
                            else MinifigCard(fig, serverUrl, imageLoader, oeffne,
                                ausgewaehlt = gewaehlt == detailSchluessel("fig", fig.figNumber))
                        }
                    }
                }
            }
        }
    }

        // Wie Galerie, Teile und Merkliste: kein „+“ im Fehlerzustand, leer steht es im Bild.
        if (!gross && anzeige != Ladeanzeige.FEHLER && anzeige != Ladeanzeige.LEER) ErfassenFab(
            erfassenText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (zeigeFilter) {
        val zuruecksetzen: () -> Unit = { onScopeChange(ScopeFilter.ALL) }
        FilterBlattRahmen(
            onSchliessen = { zeigeFilter = false },
            onZuruecksetzen = zuruecksetzen.takeIf { Filterzahl.konto(householdMembers, scopeMode) > 0 },
        ) {
            KontoFilterAbschnitt(householdMembers, scopeMode, onScopeChange)
            AnsichtAbschnitt(ansicht) { aktionen.setMinifigsView(it) }
        }
    }

    if (showAddDialog) {
        AddMinifigDialog(
            householdMembers = householdMembers,
            defaultCondition = defaultCondition,
            onDismiss = { showAddDialog = false },
            lagerorte = lagerortVorrat,
            lagerortVorgabe = lagerState.vorgabe?.name ?: "",
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
private fun FigurenKennzahlen(minifigStats: FigurenKennzahlenAnsicht) {
    KennzahlenReihe {
        // Zahlen vom Server (getMinifigStats): Aus der Liste gerechnet fehlten
        // die manuell erfassten Figuren, die hier ausgefiltert sind.
        GalleryStatChip(minifigStats.types, R.plurals.minifigs_stat_types)
        GalleryStatChip(minifigStats.totalQuantity, R.plurals.minifigs_stat_total)
        GalleryStatChip(minifigStats.manual, R.plurals.minifigs_stat_manual)
    }
}
