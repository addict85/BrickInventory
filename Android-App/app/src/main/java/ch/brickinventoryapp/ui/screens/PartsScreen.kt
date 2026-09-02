package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
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
    val financeState by vm.financeState.collectAsStateWithLifecycle()

    val parts = partsState.parts
    val stats = partsState.partsStats
    val total = partsState.partsTotal
    val isLoading = partsState.partsLoading
    val currentPage = partsState.partsPage
    val colors = partsState.partsColors
    val serverUrl = state.serverUrl
    val defaultCondition = state.userDefaultCondition ?: "N"
    val householdMembers = state.householdMembers
    val scopeMode = state.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.PARTS.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    val manualParts = financeState.partsValuation?.parts ?: emptyList()

    // Aktualisieren BEHAELT den Suchtext — frueher stand hier `search = null`,
    // die Liste sprang also auf den ganzen Bestand, waehrend das Suchfeld
    // daneben den Text weiter anzeigte. Die Galerie macht es genauso
    // (onRefresh = loadSets()).
    val onRefresh: () -> Unit = { vm.loadParts(); vm.loadValuation() }
    val onSearch: (String) -> Unit = vm::setPartsQuery
    val onLoadMore: (Int) -> Unit = { vm.loadParts(page = it) }
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.PARTS, it) }
    val onDeletePart: (String, Int) -> Unit = { partNumber, colorId -> vm.deletePart(partNumber, colorId) }
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
        // Kontofilter — erscheint nur bei einem Hauptkonto mit Unterkonten.
        if (householdMembers.size > 1) {
            ScopeFilterChip(
                members = householdMembers,
                current = scopeMode,
                onSelect = onScopeChange,
                modifier = Modifier.padding(start = 14.dp, top = 8.dp)
            )
        }
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

        // Search
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it; onSearch(it) },
            placeholder = { Text(stringResource(R.string.parts_search_placeholder)) },
            leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(20.dp)) },
            trailingIcon = {
                if (searchQuery.isNotEmpty())
                    IconButton(onClick = { searchQuery = ""; onSearch("") }) { Icon(Icons.Default.Clear, stringResource(R.string.parts_delete)) }
            },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
            singleLine = true,
            shape = Formen.karte,
            colors = OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
            )
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
                    items(distinctParts, key = { "${it.partNumber}-${it.colorId}" }) { part ->
                        PartCard(part, serverUrl, imageLoader)
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
                TextButton(onClick = { onDeletePart(part.partNumber, part.colorId); deletingPart = null }) {
                    Text(stringResource(R.string.parts_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deletingPart = null }) { Text(stringResource(R.string.parts_cancel)) } }
        )
    }
}

@Composable
fun ManualPartTile(part: PartValuationItem, serverUrl: String, imageLoader: ImageLoader, onEdit: () -> Unit, onDelete: () -> Unit) {
    val ctx = LocalContext.current
    val colorObj = remember(part.colorHex) {
        part.colorHex?.let {
            try { Color(android.graphics.Color.parseColor("#$it")) } catch (_: Exception) { null }
        }
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)

    Card(
        onClick = onEdit,  // ganze Karte klickbar — öffnet den Kaufpreis/Anzahl-Dialog, analog Sets
        modifier = Modifier.width(112.dp).height(178.dp),
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(76.dp)) {
                if (imageUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(ctx).data(imageUrl).crossfade(true).build(),
                        imageLoader = imageLoader,
                        contentDescription = part.partName,
                        onState = { st ->
                            if (st is coil.compose.AsyncImagePainter.State.Error) onImageError()
                        },
                        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(28.dp), tint = Color.Unspecified)
                    }
                }
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Formen.marke,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp)
                ) {
                    Text("${part.quantity}×", Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                if (colorObj != null) {
                    Box(Modifier.size(12.dp).align(Alignment.BottomStart).padding(3.dp).clip(CircleShape).background(colorObj))
                }
                Row(Modifier.align(Alignment.TopStart).padding(2.dp)) {
                    IconButton(onClick = onEdit, modifier = Modifier.size(24.dp)) {
                        Icon(Icons.Default.Edit, stringResource(R.string.parts_edit), Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
                IconButton(onClick = onDelete, modifier = Modifier.align(Alignment.BottomEnd).size(24.dp)) {
                    Icon(Icons.Default.Delete, stringResource(R.string.parts_delete), Modifier.size(14.dp), tint = MaterialTheme.colorScheme.error)
                }
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = 4.dp)) {
                Text(part.partName ?: part.partNumber, style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (part.colorName != null) {
                    Text(part.colorName, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.padding(top = 3.dp)) { ConditionBadges(part.conditions, part.condition) }
                // Wem gehört der Eintrag? Der Server hängt owners nur an, wenn
                // mehrere Konten im Blickfeld sind — im Einzelkonto stünde an
                // jeder Kachel „gehört mir".
                OwnerBadges(part.owners, Modifier.padding(top = 2.dp))
            }
        }
    }
}

@Composable
fun PartCard(part: Part, serverUrl: String, imageLoader: ImageLoader) {
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
        modifier = Modifier.fillMaxWidth().height(164.dp),
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
                            .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)),
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
