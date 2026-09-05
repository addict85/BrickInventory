package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
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
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSets, setScope, …)
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartsStats
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.BrickColor
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil.compose.AsyncImage
import coil.ImageLoader
import coil.request.ImageRequest

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PartsScreen(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    /**
     * Öffnet die Detailansicht eines manuell erfassten Teils. Bleibt Parameter,
     * weil nur der Navigationsgraph den NavController kennt.
     */
    onOpenDetail: (partNumber: String, colorId: Int) -> Unit = { _, _ -> },
    /**
     * Scroll-Zustand der Liste. Kommt von aussen, weil das Ziel beim Öffnen
     * der Detailansicht verlassen und danach neu zusammengesetzt wird — ein
     * `rememberLazyGridState()` hier drin würde dabei zurückgesetzt und die
     * Liste spränge nach oben (Nachtrag 92).
     */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    // ── Zustand und Aktionen: vom ViewModel statt über zwanzig Parameter ─────
    //
    // Dieser Schirm nahm bis Nachtrag 96 zwanzig Parameter entgegen. Jede
    // Erweiterung fasste dadurch drei Dateien an — Screen, Graph, ViewModel —
    // und das war bei den letzten beiden Änderungen (Kontofilter,
    // Scroll-Zustand) jedes Mal spürbar.
    //
    // Die Bauart daneben gibt es längst: ManualItemDetailScreen und
    // AcquisitionManagementScreen nehmen `vm` und lesen selbst. Sie kommen mit
    // sechs bis acht Parametern aus.
    //
    // Die Werte behalten hier ABSICHTLICH ihre alten Namen. Dadurch bleibt der
    // ganze Rumpf darunter Zeile für Zeile unverändert — der Umbau betrifft nur
    // diesen Kopf, und ein Tippfehler kann sich nicht durch fünfhundert Zeilen
    // ziehen.
    val state by vm.state.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()

    val parts = partsState.parts
    val stats = partsState.partsStats
    val total = partsState.partsTotal
    val isLoading = partsState.partsLoading
    val currentPage = partsState.partsPage
    val colors = partsState.partsColors
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: "N"
    val householdMembers = state.householdMembers
    val scopeMode = state.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.PARTS.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    val manualParts = partsState.manualParts ?: emptyList()

    // Aktualisieren BEHAELT den Suchtext — frueher stand hier `search = null`,
    // die Liste sprang also auf den ganzen Bestand, waehrend das Suchfeld
    // daneben den Text weiter anzeigte. Die Galerie macht es genauso
    // (onRefresh = loadSets()).
    val onRefresh: () -> Unit = { vm.loadParts() }
    val onSearch: (String) -> Unit = vm::setPartsQuery
    val onLoadMore: (Int) -> Unit = { vm.loadParts(page = it) }
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.PARTS, it) }
    val ansicht = partsState.partsView
    // Besitzer der Karte mitgeben — Begruendung wie in MinifigsScreen.
    val onDeletePart: (String, Int, Int?) -> Unit = { partNumber, colorId, owner ->
        vm.deletePart(partNumber, colorId, owner)
    }
    val onAddPart: (String, Int, String?, String?, Int, String?, Double?, String?, Int?) -> Unit =
        { num, colorId, colorName, colorHex, qty, note, unitPrice, cond, owner ->
            vm.addPart(num, colorId, colorName, colorHex, qty, note, unitPrice, cond, owner)
        }

    // Das Feld zeigt, was im Zustand steht. `remember(...)` darauf geschluesselt
    // statt `rememberSaveable`: Der Text ueberlebt jetzt im ViewModel, und beim
    // Zuruecknavigieren soll das Feld zum tatsaechlichen Filter der Liste
    // passen — nicht zu einem eigenen, davon unabhaengigen Gedaechtnis.
    var searchQuery by remember(partsState.partsQuery) { mutableStateOf(partsState.partsQuery) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var deletingPart by remember { mutableStateOf<PartValuationItem?>(null) }
    // Dedup nur neu berechnen, wenn sich die Daten aendern — nicht bei jeder Recomposition
    val distinctParts = remember(parts) { parts.distinctBy { "${it.partNumber}-${it.colorId}" } }
    val endReached by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= parts.size - 4 && parts.size < total && !isLoading
        }
    }
    LaunchedEffect(endReached) { if (endReached) onLoadMore(currentPage + 1) }

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        ScopeFilterZeile(householdMembers, scopeMode, onScopeChange)
        // Stats chips
        if (stats != null) {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    GalleryStatChip("${stats.uniqueParts}", stringResource(R.string.parts_stat_types))
                    GalleryStatChip("${stats.uniqueColors}", stringResource(R.string.parts_stat_colors))
                    GalleryStatChip(ch.brickinventoryapp.util.fmtInt(stats.totalParts), stringResource(R.string.parts_stat_total))
                }
            }
        }

        // Suchfeld — gemeinsamer Baustein. Der Leeren-Knopf sagte hier
        // „Löschen" (parts_delete, derselbe Text wie am Loeschknopf des Teils);
        // jetzt „Suche leeren" (Nachtrag 132).
        Suchfeld(
            wert = searchQuery,
            onWert = { searchQuery = it; onSearch(it) },
            platzhalter = stringResource(R.string.parts_search_placeholder),
        )

        // Ersatzteil-Filter — dieselben drei Werte wie das Auswahlfeld der
        // Webapp (parts-spare). Er fehlte hier ganz: Die App las `is_spare`
        // aus der Antwort und hatte sogar einen Helfer dafuer, benutzte aber
        // beides nirgends. Wer am Telefon nachsah, wie viele Teile er wirklich
        // hat, bekam die Ersatzteile immer mitgezaehlt.
        //
        // Gefiltert wird auf dem SERVER (partsSpare im UiState) — clientseitig
        // ueber die geladene Seite gefiltert koennte eine ganze Seite wegfallen
        // und die Liste bliebe scheinbar leer.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val filter = listOf(
                "" to R.string.parts_filter_all,
                "0" to R.string.parts_filter_no_spare,
                "1" to R.string.parts_filter_spare,
            )
            for ((wert, text) in filter) {
                FilterChip(
                    selected = partsState.partsSpare == wert,
                    onClick = { vm.setPartsSpare(wert) },
                    label = { Text(stringResource(text), fontSize = 13.sp) },
                )
            }
        }

        // Farbe und Kategorie — die beiden Filterlisten der Webapp
        // (03-parts.js, loadPartsFilters). Sie fehlten in der App ganz;
        // gefunden beim Vergleich der Server-Adressen beider Clients.
        //
        // Die Umrechnung auf die gemeinsame Form steht hier und nicht im
        // Bildschirm darunter: Die beiden Antworten tragen verschiedene
        // Feldnamen, alles andere ist gleich.
        val farbEintraege = remember(partsState.partsFilterColors) {
            partsState.partsFilterColors.mapNotNull { f ->
                f.colorName?.takeIf { it.isNotBlank() }?.let { name ->
                    TeileFilterEintrag(
                        wert = name, text = name, anzahl = f.uniqueParts,
                        farbe = f.colorHex?.let {
                            try { Color(android.graphics.Color.parseColor("#$it")) }
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
        TeileFilterZeile(
            farben = farbEintraege,
            kategorien = kategorieEintraege,
            farbeGewaehlt = partsState.partsColorFilter,
            kategorieGewaehlt = partsState.partsCategoryFilter,
            onFarbe = { vm.setPartsColorFilter(it) },
            onKategorie = { vm.setPartsCategoryFilter(it) },
            modifier = Modifier.padding(horizontal = 14.dp).padding(bottom = 8.dp),
        )

        // Karten oder Tabelle — wie das Auswahlfeld parts-view der Webapp.
        // Eigene Zeile, weil die drei Ersatzteil-Chips darueber die Breite
        // eines Telefons schon fuellen.
        AnsichtUmschalter(
            aktuell = ansicht,
            onWechsel = { vm.setPartsView(it) },
            modifier = Modifier.padding(horizontal = 14.dp).padding(bottom = 8.dp),
        )

        if (isLoading && parts.isEmpty() && manualParts.isEmpty()) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        } else if (parts.isEmpty() && manualParts.isEmpty()) {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(40.dp), tint = Color.Unspecified)
                    Text(stringResource(R.string.parts_none), fontWeight = FontWeight.SemiBold)
                }
            }
        } else {
            PullToRefreshBox(isRefreshing = isLoading && parts.isNotEmpty(), onRefresh = onRefresh) {
                LazyVerticalGrid(
                    state = gridState,
                    columns = GridCells.Adaptive(110.dp),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Manuell erfasste Teile als Grid-Sektion: vorher sassen sie
                    // in einer fixen FlowRow ÜBER dem Grid (eigener Scroll-
                    // Container) — dadurch scrollte nur der Set-Teil der Liste.
                    // Als Grid-Items scrollt alles als EINE Liste.
                    if (manualParts.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.parts_manual_section))
                        }
                        items(manualParts, key = { "manual-${it.id ?: "${it.partNumber}-${it.colorId}"}" }) { part ->
                            ManualPartTile(
                                part = part,
                                serverUrl = serverUrl,
                                imageLoader = imageLoader,
                                waehrung = waehrung,
                                onEdit = { onOpenDetail(part.partNumber, part.colorId) },
                                onDelete = { deletingPart = part }
                            )
                        }
                        if (distinctParts.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
                                SectionHeader(stringResource(R.string.parts_sets_section))
                            }
                        }
                    }
                    // In der Tabellenansicht nimmt jede Zeile die ganze Breite
                    // (span = maxLineSpan). Der Raster-Container bleibt derselbe —
                    // mit einem zweiten Container waeren Scrollstand,
                    // Endlos-Nachladen und die manuelle Sektion doppelt zu
                    // pflegen. Die manuellen Eintraege bleiben in BEIDEN
                    // Ansichten Kacheln, genau wie in der Webapp: Dort haengt
                    // #manual-parts-list nicht an parts-view.
                    items(
                        distinctParts,
                        key = { "${it.partNumber}-${it.colorId}" },
                        span = { if (ansicht == "table") GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { part ->
                        // BEIDE Ansichten oeffnen denselben Dialog — eine
                        // Ansicht darf nicht koennen, was die andere nicht kann.
                        val oeffne = { vm.oeffneSetItem("part", part.partNumber, part.colorId) }
                        if (ansicht == "table") PartTableRow(part, serverUrl, imageLoader, oeffne)
                        else PartCard(part, serverUrl, imageLoader, oeffne)
                    }
                    if (isLoading) {
                        // Fester Schlüssel wie bei den Kopfzeilen darüber — siehe
                        // die Begründung in GalleryScreen.kt (Nachtrag 108).
                        item(key = "parts-loading-more", span = { GridItemSpan(maxLineSpan) }) {
                            Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) {
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

    if (showAddDialog) {
        AddPartDialog(
            householdMembers = householdMembers,
            colors = colors,
            onDismiss = { showAddDialog = false },
            onAdd = { num, colorId, colorName, colorHex, qty, note, unitPrice, cond, owner ->
                showAddDialog = false
                onAddPart(num, colorId, colorName, colorHex, qty, note, unitPrice, cond, owner)
            },
            defaultCondition = defaultCondition
        )
    }

    deletingPart?.let { part ->
        AlertDialog(
            onDismissRequest = { deletingPart = null },
            icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text(stringResource(R.string.parts_delete_title)) },
            text = { Text(stringResource(R.string.parts_delete_text, part.partName ?: part.partNumber)) },
            confirmButton = {
                TextButton(onClick = { onDeletePart(part.partNumber, part.colorId, part.userId); deletingPart = null }) {
                    Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deletingPart = null }) { Text(stringResource(R.string.common_cancel)) } }
        )
    }
}

@Composable
fun ManualPartTile(part: PartValuationItem, serverUrl: String, imageLoader: ImageLoader,
                   waehrung: String, onEdit: () -> Unit, onDelete: () -> Unit) {
    val farbe = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color(android.graphics.Color.parseColor("#$it")) } catch (_: Exception) { null }
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
        notiz = part.note,
        onEdit = onEdit,
        onDelete = onDelete,
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
            try { Color(android.graphics.Color.parseColor("#$it")) }
            catch (_: Exception) { null }
        }
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)

    Card(
        // Antippen oeffnet den Detail-Dialog (Marcos Wunsch). Bis dahin war
        // die Kachel eines Teils aus einem Set tot — anders als bei manuell
        // erfassten Teilen gab es dazu nichts zu sehen.
        modifier = Modifier.fillMaxWidth().height(164.dp)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
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
                            if (st is coil.compose.AsyncImagePainter.State.Error) onImageError()
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
                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
                ) {
                    Text("${qty}×", Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
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
                    fontSize = 11.sp,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (part.colorName != null)
                    Text(part.colorName, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, fontSize = 10.sp)
                // Ersatzteil — Sets enthalten ein Tuetchen davon. Nur wenn es
                // eines IST: eine Plakette „kein Ersatzteil" an jeder Kachel
                // waere Rauschen.
                if (part.isSpare) ErsatzteilPlakette(Modifier.padding(top = 2.dp))
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
        modifier = Modifier.padding(horizontal = 2.dp, vertical = 4.dp))
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
 * das tut er nur in dieser Ansicht (loadParts in PartsFeature.kt).
 */
@Composable
fun PartTableRow(part: Part, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val farbe = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color(android.graphics.Color.parseColor("#$it")) }
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
