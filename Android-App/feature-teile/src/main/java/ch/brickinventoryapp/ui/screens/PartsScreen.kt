package ch.brickinventoryapp.ui.screens

import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.components.fokusRahmen
import ch.brickinventoryapp.ui.theme.farbeAusHex
import ch.brickinventoryapp.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.ui.model.ManuellesTeilAnsicht
import ch.brickinventoryapp.ui.model.TeilAnsicht
import ch.brickinventoryapp.ui.model.TeileKennzahlenAnsicht
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.ZustandsHinweis
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.ui.components.Abschnittstitel
import ch.brickinventoryapp.ui.components.ErfassenFab
import ch.brickinventoryapp.ui.components.FabPlatz
import ch.brickinventoryapp.ui.components.LesbareSpalten
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.OfflineHinweis
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.detailSchluessel
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.katalogName
import ch.brickinventoryapp.ui.components.kategorieUebersetzer
import ch.brickinventoryapp.ui.model.LagerortAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht

/** Was der Teile- und der Figurenreiter zeigen; die Routen sammeln es aus den Flüssen. */
data class TeileZustand(
    val state: AppUiState,
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
fun PartsScreen(
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
    val defaultCondition = state.userDefaultCondition ?: "N"
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ScopeFilter.View.PARTS.key]
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
    val lagerModus = lagerState.modi[ScopeFilter.View.PARTS.key] ?: ""
    val onLagerChange: (String) -> Unit = { aktionen.setLagerFilter(ScopeFilter.View.PARTS, it) }
    val ansicht = partsState.partsView
    val onAddPart: (String, Int, String?, String?, Int, Double?, String?, Int?, String?) -> Unit =
        { num, colorId, colorName, colorHex, qty, unitPrice, cond, owner, ort ->
            aktionen.addPart(num, colorId, colorName, colorHex, qty, unitPrice, cond, owner, ort)
        }
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
                    if (partsState.partsSpare.isNotBlank()) aktionen.setPartsSpare("")
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
                        span = { if (ansicht == "table") GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { part ->
                        // BEIDE Ansichten oeffnen denselben Dialog — eine
                        // Ansicht darf nicht koennen, was die andere nicht kann.
                        val oeffne = { aktionen.oeffneSetItem("part", part.partNumber, part.colorId) }
                        Bewegt {
                            if (ansicht == "table") PartTableRow(part, serverUrl, imageLoader, oeffne)
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
            onAdd = { num, colorId, colorName, colorHex, qty, unitPrice, cond, owner, ort ->
                showAddDialog = false
                onAddPart(num, colorId, colorName, colorHex, qty, unitPrice, cond, owner, ort)
            },
            defaultCondition = defaultCondition
        )
    }

    // Gelöscht wird im Detail (ManualItemDetailScreen, showDeleteConfirm), nicht auf
    // der Kachel.
}

/** Das Filterblatt der Teile: Konto, Lagerort, Ersatzteile, Farbe und Kategorie, Ansicht. */
@Composable
private fun TeileFilterBlatt(
    aktionen: TeileAktionen,
    partsState: PartsUiState,
    householdMembers: List<MitgliedAnsicht>,
    scopeMode: String,
    onScopeChange: (String) -> Unit,
    lagerorte: List<LagerortAnsicht>,
    lagerModus: String,
    onLagerChange: (String) -> Unit,
    farbEintraege: List<TeileFilterEintrag>,
    kategorieEintraege: List<TeileFilterEintrag>,
    onSchliessen: () -> Unit,
) {
    val ersatz = partsState.partsSpare
    val farbe = partsState.partsColorFilter
    val kategorie = partsState.partsCategoryFilter
    // Nur zurücksetzen, was abweicht: Jede Änderung lädt die Liste neu.
    val zuruecksetzen: () -> Unit = {
        if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
        if (Filterzahl.lager(lagerorte, lagerModus) > 0) onLagerChange("")
        if (ersatz.isNotBlank()) aktionen.setPartsSpare("")
        if (farbe.isNotBlank()) aktionen.setPartsColorFilter("")
        if (kategorie.isNotBlank()) aktionen.setPartsCategoryFilter("")
    }
    val aktiv = Filterzahl.teile(householdMembers, scopeMode, lagerorte, lagerModus, ersatz, farbe, kategorie)
    FilterBlattRahmen(onSchliessen = onSchliessen, onZuruecksetzen = zuruecksetzen.takeIf { aktiv > 0 }) {
        KontoFilterAbschnitt(householdMembers, scopeMode, onScopeChange)
        LagerortFilterAbschnitt(lagerorte, lagerModus, onLagerChange, nachTeilen = true)
        // Ersatzteile — dieselben drei Werte wie parts-spare in der Webapp,
        // gefiltert auf dem SERVER (partsSpare im Zustand).
        FilterAbschnitt(stringResource(R.string.filter_section_spare)) {
            for ((wert, text) in listOf(
                "" to R.string.parts_filter_all,
                "0" to R.string.parts_filter_no_spare,
                "1" to R.string.parts_filter_spare,
            )) {
                FilterWahl(stringResource(text), ersatz == wert) { aktionen.setPartsSpare(wert) }
            }
        }
        if (farbEintraege.isNotEmpty() || kategorieEintraege.isNotEmpty()) {
            FilterAbschnitt(stringResource(R.string.filter_section_color_category)) {
                TeileFilterZeile(
                    farben = farbEintraege,
                    kategorien = kategorieEintraege,
                    farbeGewaehlt = farbe,
                    kategorieGewaehlt = kategorie,
                    onFarbe = { aktionen.setPartsColorFilter(it) },
                    onKategorie = { aktionen.setPartsCategoryFilter(it) },
                )
            }
        }
        AnsichtAbschnitt(partsState.partsView) { aktionen.setPartsView(it) }
    }
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

@Composable
fun ManualPartTile(part: ManuellesTeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                   waehrung: String, onEdit: () -> Unit) {
    val farbe = remember(part.colorHex) {
        farbeAusHex(part.colorHex)
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (bild, onBildFehler) =
        rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Gemeinsame Kachel mit den Minifiguren — siehe ManuelleKachel.
    ManuelleKachel(
        bildUrl = bild,
        onBildFehler = onBildFehler,
        imageLoader = imageLoader,
        name = part.partName ?: part.partNumber,
        menge = part.quantity,
        zustaende = part.conditions,
        zustand = part.condition,
        besitzer = part.owners,
        preis = part.avgPurchasePrice ?: part.unitPrice ?: part.purchasePrice,
        waehrung = waehrung,
        onEdit = onEdit,
        farbe = farbe,
        farbname = part.colorName?.let { farbUebersetzer()(it) },
    )
}

/** Bildfläche der Teilekachel: wächst mit der Kachel, auf dem Telefon wie bisher rund 90 dp hoch. */
private const val TEIL_BILD_VERHAELTNIS = 4f / 3f

@Composable
fun PartCard(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
             onClick: (() -> Unit)? = null, ausgewaehlt: Boolean = false) {
    val ctx = LocalContext.current
    val qty = part.totalQuantity.takeIf { it > 0 } ?: 1
    val colorObj = remember(part.colorHex) {
        farbeAusHex(part.colorHex)
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Ab grosser Schrift eine Listenzeile wie die Sets: Das Bild über die volle Breite
    // liess ein Teil je Bildschirm. Die Menge rückt dann vom Bild in den Text.
    val zeile = grosseSchrift()
    val weich = !bewegungReduziert()
    val menge: @Composable () -> Unit = {
        Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.marke) {
            Text(mengeAusSet(qty), Modifier.padding(horizontal = Abstaende.winzig, vertical = 1.dp)
                .vorgelesenAls(stueckzahl(qty)),
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }

    // Mit der Kachel wachsend statt fest 90 dp: Auf dem Tablet stand sonst ein kleines
    // Bild über einer breiten Kachel.
    val bildflaeche: @Composable (Modifier) -> Unit = { flaeche ->
        Box(flaeche) {
            ProduktBild(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(weich).build() },
                imageLoader = imageLoader,
                // Ohne Beschreibung: Der Name steht darunter, TalkBack las ihn sonst zweimal.
                contentDescription = null,
                onState = { st ->
                    if (st is coil3.compose.AsyncImagePainter.State.Error) onImageError()
                },
                modifier = Modifier.fillMaxSize()
                    .clip(Formen.kachelBildEcken),
                contentScale = ContentScale.Fit,
                ersatzGroesse = 32.dp,
                // Der Bildgrund über die ganze Kachelbreite wie bei den Sets: Ein schmales
                // Bild stand sonst als Kasten mit weissen Rändern in der Karte.
                bildgrund = true,
                innenAbstand = Abstaende.winzig,
            )
            if (!zeile) Box(Modifier.align(Alignment.TopEnd).padding(Abstaende.winzig)) { menge() }
            // Color dot
            if (colorObj != null) {
                Box(
                    Modifier.size(14.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(colorObj)
                )
            }
        }
    }

    val texte: @Composable (Modifier) -> Unit = { spalte ->
        Column(spalte.padding(horizontal = 7.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            if (zeile) menge()
            val nummer = part.blPartNumber ?: part.partNumber
            Text(nummer, Modifier.vorgelesenAls(stringResource(R.string.cd_teil_nummer, nummer)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold)
            Text(part.partName?.let { katalogName(it) }
                    ?: androidx.compose.ui.text.AnnotatedString(stringResource(R.string.name_unknown)),
                style = MaterialTheme.typography.bodySmall,
                color = if (part.partName == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                // Im Raster immer zwei Zeilen Platz: Kacheln einer Reihe sind gleich hoch,
                // auch wenn ein Name kurz ist. Die Zeile muss niemandem gleichen.
                minLines = if (zeile) 1 else 2,
                maxLines = if (zeile) 4 else 2, overflow = TextOverflow.Ellipsis)
            part.colorName?.let {
                Text(farbUebersetzer()(it), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            // Ersatzteil — Sets enthalten ein Tuetchen davon. Nur wenn es
            // eines IST: eine Plakette „kein Ersatzteil" an jeder Kachel
            // waere Rauschen.
            if (part.isSpare) ErsatzteilPlakette(Modifier.padding(top = Abstaende.haar))
        }
    }

    Card(
        // Antippen öffnet den Detail-Dialog, wie bei manuell erfassten Teilen.
        modifier = Modifier.fillMaxWidth().heightIn(min = if (zeile) 0.dp else 164.dp)
            .semantics { selected = ausgewaehlt }
            .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.leiste) else Modifier)
            .let { if (onClick != null) it.fokusRahmen(Formen.leiste).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        if (zeile) Row(verticalAlignment = Alignment.Top) {
            bildflaeche(Modifier.width(ZEILE_BILD_BREITE).aspectRatio(TEIL_BILD_VERHAELTNIS))
            texte(Modifier.weight(1f))
        } else Column {
            bildflaeche(Modifier.fillMaxWidth().aspectRatio(TEIL_BILD_VERHAELTNIS))
            texte(Modifier)
        }
    }
}

/** Breite des Vorschaubilds, wenn die Kachel bei grosser Schrift eine Listenzeile ist. */
private val ZEILE_BILD_BREITE = 96.dp

/** Sektions-Überschrift innerhalb der Grids (Manuell erfasst / Aus Sets). */
@Composable
fun SectionHeader(text: String) {
    Abschnittstitel(text,
        Modifier.padding(horizontal = Abstaende.haar, vertical = Abstaende.winzig))
}

/**
 * Ein Teil als Tabellenzeile.
 * Ausführlich: docs/begruendungen/feature-teile/ui/screens/PartsScreen.kt.md#parttablerow
 */
@Composable
fun PartTableRow(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val farbe = remember(part.colorHex) {
        farbeAusHex(part.colorHex)
    }
    val (bildUrl, onFehler) = rememberTileImageWithFallback(
        serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Kategorie und Sets in einer Zeile, mit „·" getrennt — und nur, was da
    // ist. Ein leeres „ · " sieht nach einem fehlenden Wert aus.
    val ersatzteil = stringResource(R.string.parts_spare_tag)
    val kategorie = kategorieUebersetzer()
    val zweite = listOfNotNull(
        part.categoryName?.takeIf { it.isNotBlank() }?.let(kategorie),
        part.inSets?.takeIf { it.isNotBlank() }?.replace(",", ", "),
        // In der Tabellenzeile als Wort statt als Plakette: Die Zeile ist auf
        // Dichte gebaut, eine Flaeche mit eigenem Hintergrund saehe darin aus
        // wie ein Knopf.
        ersatzteil.takeIf { part.isSpare },
    ).joinToString(" · ").ifBlank { null }

    TabellenZeile(
        bildUrl = bildUrl,
        nummer = part.blPartNumber ?: part.partNumber,
        name = part.partName,
        menge = part.totalQuantity.takeIf { it > 0 } ?: 1,
        imageLoader = imageLoader,
        farbe = farbe,
        zweiteZeile = zweite,
        onBildFehler = onFehler,
        onClick = onClick,
    )
}
