package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartsStats
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.ui.model.FarbeAnsicht
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.core.graphics.toColorInt
import coil3.compose.AsyncImage
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
    val farbEintraege = remember(partsState.partsFilterColors) {
        partsState.partsFilterColors.mapNotNull { f ->
            f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                TeileFilterEintrag(
                    wert = name, text = name, anzahl = f.uniqueParts,
                    farbe = f.colorHex?.let {
                        try { Color("#$it".toColorInt()) }
                        catch (_: Exception) { null }
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

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Suche und „Filter“: Konto, Lagerort, Ersatzteile, Farbe, Kategorie
        // und die Ansicht stehen im Blatt, die Kennzahlen rollen mit dem Raster.
        SucheMitFilter(
            wert = searchQuery,
            onWert = { searchQuery = it; onSearch(it) },
            platzhalter = stringResource(R.string.parts_search_placeholder),
            aktiveFilter = Filterzahl.teile(householdMembers, scopeMode, lagerorte, lagerModus,
                partsState.partsSpare, partsState.partsColorFilter, partsState.partsCategoryFilter),
            onFilter = { zeigeFilter = true },
        )

        ch.brickinventoryapp.ui.components.OfflineHinweis(partsState.teileOfflineStand)
        val teileGefiltert = searchQuery.isNotBlank() || Filterzahl.teile(householdMembers, scopeMode, lagerorte,
            lagerModus, partsState.partsSpare, partsState.partsColorFilter, partsState.partsCategoryFilter) > 0
        val anzeige = ladeanzeige(parts.isNotEmpty() || manualParts.isNotEmpty(), isLoading, partsState.partsFehler, teileGefiltert)
        if (anzeige == Ladeanzeige.LAEDT) {
            SkelettRaster(GridCells.Adaptive(110.dp), kachelHoehe = 164.dp, abstand = Abstaende.klein)
        } else if (anzeige == Ladeanzeige.FEHLER) {
            ZustandsHinweis { FehlerHinweis(partsState.partsFehler, onRefresh) }
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
                    columns = GridCells.Adaptive(110.dp),
                    contentPadding = PaddingValues(Abstaende.mittel),
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
                            else PartCard(part, serverUrl, imageLoader, oeffne)
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

        FloatingActionButton(
            onClick = { showAddDialog = true },
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            shape = Formen.fab,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp)
        ) { Icon(Icons.Default.Add, stringResource(R.string.parts_add)) }
    }

    if (zeigeFilter) {
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
        FilterBlattRahmen(onSchliessen = { zeigeFilter = false }, onZuruecksetzen = zuruecksetzen.takeIf { aktiv > 0 }) {
            KontoFilterAbschnitt(householdMembers, scopeMode, onScopeChange)
            LagerortFilterAbschnitt(lagerorte, lagerModus, onLagerChange)
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
            AnsichtAbschnitt(ansicht) { vm.setPartsView(it) }
        }
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

/** Die Kennzahlen der Teile — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun TeileKennzahlen(stats: PartsStats) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        GalleryStatChip("${stats.uniqueParts}", stringResource(R.string.parts_stat_types))
        GalleryStatChip("${stats.uniqueColors}", stringResource(R.string.parts_stat_colors))
        GalleryStatChip(ch.brickinventoryapp.util.fmtInt(stats.totalParts), stringResource(R.string.parts_stat_total))
    }
}

@Composable
fun ManualPartTile(part: PartValuationItem, serverUrl: String, imageLoader: ImageLoader,
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
        farbname = part.colorName,
        platzhalter = {
            Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null,
                Modifier.size(28.dp), tint = Color.Unspecified)
        },
    )
}

@Composable
fun PartCard(part: Part, serverUrl: String, imageLoader: ImageLoader,
             onClick: (() -> Unit)? = null) {
    val ctx = LocalContext.current
    val qty = part.totalQuantity.takeIf { it > 0 } ?: 1
    val colorObj = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color("#$it".toColorInt()) }
            catch (_: Exception) { null }
        }
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)

    Card(
        // Antippen öffnet den Detail-Dialog, wie bei manuell erfassten Teilen.
        modifier = Modifier.fillMaxWidth().heightIn(min = 164.dp)
            .let { if (onClick != null) it.clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(90.dp)) {
                if (imageUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(ctx).data(imageUrl).crossfade(true).build(),
                        imageLoader = imageLoader,
                        contentDescription = part.partName,
                        onState = { st ->
                            if (st is coil3.compose.AsyncImagePainter.State.Error) onImageError()
                        },
                        modifier = Modifier.fillMaxSize()
                            .clip(Formen.kachelBildEcken),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Box(Modifier.fillMaxSize(), Alignment.Center) { Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(28.dp), tint = Color.Unspecified) }
                }
                // Qty badge
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Formen.marke,
                    modifier = Modifier.align(Alignment.TopEnd).padding(Abstaende.winzig)
                ) {
                    Text(mengeAusSet(qty), Modifier.padding(horizontal = Abstaende.winzig, vertical = 1.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                // Color dot
                if (colorObj != null) {
                    Box(
                        Modifier.size(14.dp).align(Alignment.BottomStart).padding(3.dp)
                            .clip(CircleShape).background(colorObj)
                    )
                }
            }
            Column(Modifier.padding(horizontal = 7.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(part.blPartNumber ?: part.partNumber,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold)
                Text(part.partName ?: "—",
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (part.colorName != null)
                    Text(part.colorName, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                // Ersatzteil — Sets enthalten ein Tuetchen davon. Nur wenn es
                // eines IST: eine Plakette „kein Ersatzteil" an jeder Kachel
                // waere Rauschen.
                if (part.isSpare) ErsatzteilPlakette(Modifier.padding(top = Abstaende.haar))
            }
        }
    }
}

/** Sektions-Überschrift innerhalb der Grids (Manuell erfasst / Aus Sets). */
@Composable
fun SectionHeader(text: String) {
    Text(text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        letterSpacing = 0.8.sp,
        modifier = Modifier.padding(horizontal = Abstaende.haar, vertical = Abstaende.winzig).semantics { heading() })
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
fun PartTableRow(part: Part, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val farbe = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color("#$it".toColorInt()) }
            catch (_: Exception) { null }
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
