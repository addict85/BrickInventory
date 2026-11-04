package ch.brickinventoryapp.ui.screens

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
import androidx.compose.ui.graphics.Color
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
import androidx.core.graphics.toColorInt
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.ZustandsHinweis

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PartsScreen(
    vm: TeileViewModel,
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
    // ── Zustand und Aktionen: vom ViewModel statt über zwanzig Parameter ──
    //
    // Mit zwanzig Parametern fasste jede Erweiterung drei Dateien an (Screen, Graph,
    // ViewModel). Dieselbe Bauart wie ManualItemDetailScreen und
    // AcquisitionManagementScreen, die `vm` nehmen und selbst lesen. Die Werte
    // behalten ihre alten Namen, damit der Rumpf darunter unverändert bleibt.
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()
    // Eigener Fluss: Der Lagerortfilter gehoert nicht in AppUiState, das
    // sechzehn Dateien sammeln (siehe LagerUiState).
    val lagerState by vm.lagerState.collectAsStateWithLifecycle()
    // Das Teil, dessen Detail daneben offen ist (breites Fenster); seine Kachel ist markiert.
    val gewaehlt = ch.brickinventoryapp.ui.components.LocalOffenesDetail.current

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
    val scopeMode = blick.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.PARTS.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    val manualParts = partsState.manualParts ?: emptyList()

    // Aktualisieren behält den Suchtext — sonst spränge die Liste auf den ganzen
    // Bestand, während das Feld den Text weiter zeigt. Wie in der Galerie (onRefresh =
    // loadSets()).
    val onRefresh: () -> Unit = { vm.loadParts() }
    val onSearch: (String) -> Unit = vm::setPartsQuery
    val onLoadMore: (Int) -> Unit = { vm.loadParts(page = it) }
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.PARTS, it) }
    val lagerorte = lagerState.orte
    val lagerModus = lagerState.modi[ch.brickinventoryapp.data.ScopeFilter.View.PARTS.key] ?: ""
    val onLagerChange: (String) -> Unit = { vm.setLagerFilter(ch.brickinventoryapp.data.ScopeFilter.View.PARTS, it) }
    val ansicht = partsState.partsView
    val onAddPart: (String, Int, String?, String?, Int, Double?, String?, Int?, String?) -> Unit =
        { num, colorId, colorName, colorHex, qty, unitPrice, cond, owner, ort ->
            vm.addPart(num, colorId, colorName, colorHex, qty, unitPrice, cond, owner, ort)
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
    val farbe = ch.brickinventoryapp.ui.components.farbUebersetzer()
    val farbEintraege = remember(partsState.partsFilterColors, farbe) {
        partsState.partsFilterColors.mapNotNull { f ->
            f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                TeileFilterEintrag(
                    wert = name, text = farbe(name), anzahl = f.uniqueParts,
                    farbe = f.colorHex?.let {
                        try { Color("#$it".toColorInt()) } catch (_: Exception) { null }
                    },
                )
            }
        }
    }
    val kategorieEintraege = remember(partsState.partsCategories) {
        partsState.partsCategories.mapNotNull { k ->
            k.categoryName?.takeIf { it.isNotBlank() }?.let { wert ->
                TeileFilterEintrag(wert = wert, text = k.label ?: wert, anzahl = k.uniqueParts)
            }
        }
    }

    // Ab grosser Schrift steht Erfassen in der Knopfzeile unter der Suche (SucheMitFilter).
    val gross = ch.brickinventoryapp.ui.components.grosseSchrift()
    val erfassenText = stringResource(R.string.parts_add)
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Suche und „Filter“: Konto, Lagerort, Ersatzteile, Farbe, Kategorie
        // und die Ansicht stehen im Blatt, die Kennzahlen rollen mit dem Raster.
        val teileGefiltert = searchQuery.isNotBlank() || Filterzahl.teile(householdMembers, scopeMode, lagerorte,
            lagerModus, partsState.partsSpare, partsState.partsColorFilter, partsState.partsCategoryFilter) > 0
        val anzeige = ladeanzeige(parts.isNotEmpty() || manualParts.isNotEmpty(), isLoading, partsState.partsFehler, teileGefiltert)
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

        ch.brickinventoryapp.ui.components.OfflineHinweis(partsState.teileOfflineStand)
        if (anzeige == Ladeanzeige.LAEDT) {
            SkelettRaster(ch.brickinventoryapp.ui.components.LesbareSpalten(120.dp), kachelHoehe = 164.dp, abstand = Abstaende.klein)
        } else if (anzeige == Ladeanzeige.FEHLER) {
            ZustandsHinweis { FehlerHinweis(partsState.partsFehler, onRefresh, partsState.partsFehlerKlasse) }
        } else if (anzeige != Ladeanzeige.LISTE) {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                // Die Kennzahlen meinen die ganze Sammlung — auch bei einer Suche ohne Treffer.
                if (stats != null) Box(Modifier.align(Alignment.TopStart).padding(Abstaende.mittel)) { TeileKennzahlen(stats) }
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    if (anzeige == Ladeanzeige.KEINE_TREFFER) KeinTrefferHinweis()
                    else {
                        Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(40.dp), tint = Color.Unspecified)
                        Text(stringResource(R.string.parts_none), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        } else {
            PullToRefreshBox(isRefreshing = isLoading && parts.isNotEmpty(), onRefresh = onRefresh) {
                LazyVerticalGrid(
                    state = gridState,
                    columns = ch.brickinventoryapp.ui.components.LesbareSpalten(120.dp),
                    // Unten Platz für den Erfassen-Knopf, sonst verdeckt er die letzte Reihe.
                    contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                        end = Abstaende.mittel, bottom = ch.brickinventoryapp.ui.components.FabPlatz),
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
                        val oeffne = { vm.oeffneSetItem("part", part.partNumber, part.colorId) }
                        Bewegt {
                            if (ansicht == "table") PartTableRow(part, serverUrl, imageLoader, oeffne)
                            else PartCard(part, serverUrl, imageLoader, oeffne,
                                ausgewaehlt = gewaehlt == ch.brickinventoryapp.ui.components.detailSchluessel("part", part.partNumber, part.colorId))
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

        if (!gross) ch.brickinventoryapp.ui.components.ErfassenFab(
            erfassenText, { showAddDialog = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (zeigeFilter) {
        TeileFilterBlatt(
            vm = vm,
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
    vm: TeileViewModel,
    partsState: PartsUiState,
    householdMembers: List<ch.brickinventoryapp.ui.model.MitgliedAnsicht>,
    scopeMode: String,
    onScopeChange: (String) -> Unit,
    lagerorte: List<ch.brickinventoryapp.ui.model.LagerortAnsicht>,
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
        if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ch.brickinventoryapp.data.ScopeFilter.ALL)
        if (Filterzahl.lager(lagerorte, lagerModus) > 0) onLagerChange("")
        if (ersatz.isNotBlank()) vm.setPartsSpare("")
        if (farbe.isNotBlank()) vm.setPartsColorFilter("")
        if (kategorie.isNotBlank()) vm.setPartsCategoryFilter("")
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
                FilterWahl(stringResource(text), ersatz == wert) { vm.setPartsSpare(wert) }
            }
        }
        if (farbEintraege.isNotEmpty() || kategorieEintraege.isNotEmpty()) {
            FilterAbschnitt(stringResource(R.string.filter_section_color_category)) {
                TeileFilterZeile(
                    farben = farbEintraege,
                    kategorien = kategorieEintraege,
                    farbeGewaehlt = farbe,
                    kategorieGewaehlt = kategorie,
                    onFarbe = { vm.setPartsColorFilter(it) },
                    onKategorie = { vm.setPartsCategoryFilter(it) },
                )
            }
        }
        AnsichtAbschnitt(partsState.partsView) { vm.setPartsView(it) }
    }
}

/** Die Kennzahlen der Teile — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun TeileKennzahlen(stats: TeileKennzahlenAnsicht) {
    KennzahlenReihe {
        GalleryStatChip(ch.brickinventoryapp.util.fmtInt(stats.uniqueParts), stringResource(R.string.parts_stat_types))
        GalleryStatChip(ch.brickinventoryapp.util.fmtInt(stats.uniqueColors), stringResource(R.string.parts_stat_colors))
        GalleryStatChip(ch.brickinventoryapp.util.fmtInt(stats.teileGesamt), stringResource(R.string.parts_stat_total),
            teileAufschluesselung(stats.teileAusSets, stats.teileEinzeln))
    }
}

@Composable
fun ManualPartTile(part: ManuellesTeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                   waehrung: String, onEdit: () -> Unit) {
    val farbe = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color("#$it".toColorInt()) } catch (_: Exception) { null }
        }
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
        farbname = part.colorName?.let { ch.brickinventoryapp.ui.components.farbUebersetzer()(it) },
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
        part.colorHex?.let {
            try { Color("#$it".toColorInt()) } catch (_: Exception) { null }
        }
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Ab grosser Schrift eine Listenzeile wie die Sets: Das Bild über die volle Breite
    // liess ein Teil je Bildschirm. Die Menge rückt dann vom Bild in den Text.
    val zeile = ch.brickinventoryapp.ui.components.grosseSchrift()
    val weich = !ch.brickinventoryapp.ui.components.bewegungReduziert()
    val menge: @Composable () -> Unit = {
        Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.marke) {
            Text(mengeAusSet(qty), Modifier.padding(horizontal = Abstaende.winzig, vertical = 1.dp),
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }

    // Mit der Kachel wachsend statt fest 90 dp: Auf dem Tablet stand sonst ein kleines
    // Bild über einer breiten Kachel.
    val bildflaeche: @Composable (Modifier) -> Unit = { flaeche ->
        Box(flaeche) {
            ch.brickinventoryapp.ui.components.ProduktBild(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(weich).build() },
                imageLoader = imageLoader,
                contentDescription = part.partName,
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
            Text(part.blPartNumber ?: part.partNumber,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold)
            Text(part.partName?.let { ch.brickinventoryapp.ui.components.katalogName(it) }
                    ?: androidx.compose.ui.text.AnnotatedString(stringResource(R.string.name_unknown)),
                style = MaterialTheme.typography.labelSmall,
                color = if (part.partName == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                // Im Raster immer zwei Zeilen Platz: Kacheln einer Reihe sind gleich hoch,
                // auch wenn ein Name kurz ist. Die Zeile muss niemandem gleichen.
                minLines = if (zeile) 1 else 2,
                maxLines = if (zeile) 4 else 2, overflow = TextOverflow.Ellipsis)
            part.colorName?.let {
                Text(ch.brickinventoryapp.ui.components.farbUebersetzer()(it), style = MaterialTheme.typography.labelSmall,
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
            .let { if (onClick != null) it.clickable(role = Role.Button, onClick = onClick) else it },
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
    ch.brickinventoryapp.ui.components.Abschnittstitel(text,
        Modifier.padding(horizontal = Abstaende.haar, vertical = Abstaende.winzig))
}

/**
 * Ein Teil als Tabellenzeile.
 *
 * Zeigt, was die Tabelle der Webapp zeigt (partsTableRow in 03-parts.js):
 * Bild, Nummer, Name, Farbe, Kategorie, Menge, In Sets. Die beiden breiten
 * Spalten — Kategorie und Sets — stehen als zweite Zeile darunter statt
 * daneben; sieben Spalten nebeneinander passen auf kein Telefon.
 *
 * „In Sets" ist nur gefuellt, wenn der Lader `with_sets=1` mitgegeben hat, und
 * das tut er nur in dieser Ansicht (TeileQuelle in ui/Teile.kt).
 */
@Composable
fun PartTableRow(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val farbe = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color("#$it".toColorInt()) } catch (_: Exception) { null }
        }
    }
    val (bildUrl, onFehler) = rememberTileImageWithFallback(
        serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Kategorie und Sets in einer Zeile, mit „·" getrennt — und nur, was da
    // ist. Ein leeres „ · " sieht nach einem fehlenden Wert aus.
    val ersatzteil = stringResource(R.string.parts_spare_tag)
    val zweite = listOfNotNull(
        part.categoryName?.takeIf { it.isNotBlank() },
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
