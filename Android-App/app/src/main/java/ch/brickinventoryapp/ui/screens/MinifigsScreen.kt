package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.data.model.Minifig
import ch.brickinventoryapp.util.fmtInt
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.util.fmtDatum
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.compose.AsyncImage
import coil3.ImageLoader
import coil3.request.ImageRequest
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.SkelettRaster

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MinifigsScreen(
    vm: TeileViewModel,
    imageLoader: ImageLoader,
    /** Öffnet die Detailansicht — nur der Graph kennt den NavController. */
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    /** Scroll-Zustand von aussen: Das Ziel wird beim Öffnen eines Details verworfen. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    // Zustand und Aktionen vom ViewModel statt über fünfzehn Parameter — Begründung
    // bei PartsScreen. Die Namen bleiben dieselben, damit der Rumpf darunter
    // unverändert bleibt.
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()

    val figs = partsState.minifigs
    val minifigStats = partsState.minifigStats
    val isLoading = partsState.minifigsLoading
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: "N"
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.MINIFIGS.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    val manualFigs = partsState.manualFigs ?: emptyList()
    val lagerState by vm.lagerState.collectAsStateWithLifecycle()

    val onRefresh: () -> Unit = { vm.loadMinifigs() }
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.MINIFIGS, it) }
    val onAddMinifig: (String, String?, Int, Double?, String?, Int?, String?) -> Unit =
        { num, blNum, qty, unitPrice, cond, owner, ort ->
            vm.addMinifig(num, blNum, qty, unitPrice, cond, owner, ort)
        }
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

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Suche und „Filter“: Konto und Ansicht stehen im Blatt, die
        // Kennzahlen rollen mit dem Raster.
        SucheMitFilter(
            wert = search,
            onWert = { search = it; vm.setMinifigsQuery(it) },
            platzhalter = stringResource(R.string.minifigs_search_placeholder),
            aktiveFilter = Filterzahl.konto(householdMembers, scopeMode),
            onFilter = { zeigeFilter = true },
        )

        ch.brickinventoryapp.ui.components.OfflineHinweis(partsState.figurenOfflineStand)
        when {
            isLoading && figs.isEmpty() && manualFigs.isEmpty() ->
                SkelettRaster(GridCells.Adaptive(140.dp), kachelHoehe = 196.dp)
            figs.isEmpty() && manualFigs.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                if (minifigStats.types > 0 || minifigStats.totalQuantity > 0) {
                    Box(Modifier.align(Alignment.TopStart).padding(Abstaende.mittel)) { FigurenKennzahlen(minifigStats) }
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    LeerSymbol(Icons.Default.Person)
                    Text(stringResource(R.string.minifigs_none), fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.minifigs_loaded_on_import),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            figs.isEmpty() && manualFigs.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    LeerSymbol(Icons.Default.SearchOff)
                    Text(stringResource(R.string.minifigs_no_results), fontWeight = FontWeight.SemiBold)
                }
            }
            else -> PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(140.dp),
                    state = gridState,
                    contentPadding = PaddingValues(Abstaende.mittel),
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
                        span = { _, _ -> if (ansicht == "table") GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { _, fig ->
                        // BEIDE Ansichten oeffnen denselben Dialog.
                        val oeffne = { vm.oeffneSetItem("fig", fig.figNumber) }
                        Bewegt {
                            if (ansicht == "table") MinifigTableRow(fig, serverUrl, imageLoader, oeffne)
                            else MinifigCard(fig, serverUrl, imageLoader, oeffne)
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
        ) { Icon(Icons.Default.Add, stringResource(R.string.minifigs_add)) }
    }

    if (zeigeFilter) {
        val zuruecksetzen: () -> Unit = { onScopeChange(ch.brickinventoryapp.data.ScopeFilter.ALL) }
        FilterBlattRahmen(
            onSchliessen = { zeigeFilter = false },
            onZuruecksetzen = zuruecksetzen.takeIf { Filterzahl.konto(householdMembers, scopeMode) > 0 },
        ) {
            KontoFilterAbschnitt(householdMembers, scopeMode, onScopeChange)
            AnsichtAbschnitt(ansicht) { vm.setMinifigsView(it) }
        }
    }

    if (showAddDialog) {
        AddMinifigDialog(
            householdMembers = householdMembers,
            defaultCondition = defaultCondition,
            onDismiss = { showAddDialog = false },
            lagerorte = lagerortVorrat,
            lagerortVorgabe = lagerState.vorgabe?.name ?: "",
            onAdd = { num, blNum, qty, unitPrice, cond, owner, ort ->
                showAddDialog = false
                onAddMinifig(num, blNum, qty, unitPrice, cond, owner, ort)
            }
        )
    }

    // Gelöscht wird im Detail (ManualItemDetailScreen, showDeleteConfirm) — an
    // derselben Stelle wie beim Set.
}

/** Die Kennzahlen der Minifiguren — erste Zeile des Rasters, sie rollt mit. */
@Composable
private fun FigurenKennzahlen(minifigStats: ch.brickinventoryapp.data.model.MinifigStats) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // Zahlen vom Server (getMinifigStats): Aus der Liste gerechnet fehlten
        // die manuell erfassten Figuren, die hier ausgefiltert sind.
        GalleryStatChip(fmtInt(minifigStats.types), stringResource(R.string.minifigs_stat_types))
        GalleryStatChip(fmtInt(minifigStats.totalQuantity), stringResource(R.string.minifigs_stat_total))
        GalleryStatChip(fmtInt(minifigStats.manual), stringResource(R.string.minifigs_stat_manual))
    }
}

@Composable
fun ManualFigTile(fig: FigValuationItem, serverUrl: String, imageLoader: ImageLoader,
                  waehrung: String, onEdit: () -> Unit) {
    // Vorschaubild mit Rückfall auf volle Auflösung — siehe
    // util/ImageUrls.kt, rememberTileImageWithFallback().
    val (bild, onBildFehler) =
        rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    // Alles Weitere steht in ManuelleKachel (ManualItemComposables.kt), die auch die
    // Teile benutzen — damit Zustands- und Besitzer-Plaketten nicht nur in einem
    // Zwilling nachgezogen werden.
    ManuelleKachel(
        bildUrl = bild,
        onBildFehler = onBildFehler,
        imageLoader = imageLoader,
        name = fig.figName ?: fig.figNumber,
        menge = fig.quantity,
        zustaende = fig.conditions,
        zustand = fig.condition,
        besitzer = fig.owners,
        preis = fig.avgPurchasePrice ?: fig.unitPrice ?: fig.purchasePrice,
        waehrung = waehrung,
        onEdit = onEdit,
        platzhalter = { LeerSymbol(Icons.Default.Person, 32.dp) },
    )
}

@Composable
fun AddMinifigDialog(
    onDismiss: () -> Unit,
    onAdd: (String, String?, Int, Double?, String?, Int?, String?) -> Unit,
    defaultCondition: String = "N",
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
) {
    var figNumber  by rememberSaveable { mutableStateOf("") }
    var blFigNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // Schluessel ist die Vorgabe — dieselbe Begruendung wie im Galerie-Dialog:
    // Sie kommt ueber das Netz und kann nach dem Oeffnen eintreffen.
    var lagerort   by rememberSaveable(lagerortVorgabe) { mutableStateOf(lagerortVorgabe) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }


    fun submit() {
        if (figNumber.isNotBlank()) {
            // Siehe erfassungsWerte() — dieselbe Umrechnung wie im Teile-Dialog.
            val w = erfassungsWerte(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(
                figNumber,
                blFigNumber.trim().ifBlank { null },
                w.anzahl, w.preis, w.zustand, w.besitzer,
                lagerort.trim().takeIf { it.isNotEmpty() }
            )
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text(stringResource(R.string.minifigs_add_title), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OwnerPicker(householdMembers, owner, { owner = it })
                OutlinedTextField(
                    value = figNumber, onValueChange = { figNumber = it },
                    label = { Text(stringResource(R.string.minifigs_fig_number)) }, placeholder = { Text(stringResource(R.string.minifigs_fig_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf
                )
                OutlinedTextField(
                    value = blFigNumber, onValueChange = { blFigNumber = it },
                    label = { Text(stringResource(R.string.minifigs_bl_number)) }, placeholder = { Text(stringResource(R.string.minifigs_bl_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf
                )
                Text(
                    stringResource(R.string.minifigs_bl_hint),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                ErfassungsFelder(
                    anzahl = quantity, onAnzahl = { quantity = it },
                    preis = unitPrice, onPreis = { unitPrice = it },
                    zustand = condition, onZustand = { condition = it },
                    lagerort = lagerort, onLagerort = { lagerort = it },
                    lagerorte = lagerorte,
                )
            }
        },
        confirmButton = { TextButton(onClick = { submit(); onDismiss() }) { Text(stringResource(R.string.minifigs_add_button)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}

@Composable
fun MinifigCard(fig: Minifig, serverUrl: String, imageLoader: ImageLoader,
                onClick: (() -> Unit)? = null) {
    val qty = fig.totalQuantity ?: fig.quantity

    Card(
        // Antippen oeffnet den Detail-Dialog — wie bei den Teilen daneben.
        modifier = Modifier.fillMaxWidth().heightIn(min = 196.dp)
            .let { if (onClick != null) it.clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(110.dp)) {
                // Vorschaubild mit Rückfall auf volle Auflösung — siehe
                // util/ImageUrls.kt, rememberTileImageWithFallback().
                val (figImg, onFigImgError) = rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
                if (figImg != null) {
                    AsyncImage(
                        model = figImg,
                        imageLoader = imageLoader,
                        contentDescription = fig.figName,
                        onState = { st ->
                            if (st is coil3.compose.AsyncImagePainter.State.Error) onFigImgError()
                        },
                        modifier = Modifier.fillMaxSize()
                            .clip(Formen.kachelBildEcken),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxSize()
                            .clip(Formen.kachelBildEcken)
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) { LeerSymbol(Icons.Default.Person, 36.dp) }
                    }
                }
                if (qty > 1) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopEnd).padding(Abstaende.winzig)
                    ) {
                        // Die Menge-Plakette: „×N“ auf einer manuell erfassten Kachel, „N×“ auf
                        // einer Kachel aus einem Set — die Regel der Webapp (`man-tile` mit
                        // `qbadge` ×N, `part-card` mit `part-qty` N×).
                        Text("$qty×", Modifier.padding(horizontal = 5.dp, vertical = Abstaende.haar),
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
                // Zustand nur bei manuell erfassten Minifiguren (aus Sets übernommene haben keinen
                // eigenen). Die Besitzer-Plakette dagegen immer: „Wem gehört das?“ stellt sich bei
                // einer Figur aus dem Set eines Kindes genauso, und diese Liste lädt nur
                // `source=set`. Ohne Haushalt ist `owners` leer und OwnerBadges kehrt sofort
                // zurück. Column statt Box: zwei Plaketten übereinander, nicht am selben Punkt.
                Column(Modifier.align(Alignment.BottomStart).padding(Abstaende.winzig),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                    if (fig.source == "manual") ConditionBadges(fig.conditions, fig.condition)
                    OwnerBadges(fig.owners)
                }
                if (fig.source == "manual") {
                    Surface(
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopStart).padding(Abstaende.winzig)
                    ) {
                        Text(stringResource(R.string.minifigs_manual_badge), Modifier.padding(horizontal = 5.dp, vertical = Abstaende.haar),
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Column(Modifier.padding(Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(fig.figNumber, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                Text(fig.figName ?: fig.figNumber,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                // Gemeinsamer Helfer (util/DatumFormat.kt): Er kommt auch mit Zeitstempeln ohne
                // Millisekunden zurecht.
                val dateLabel = remember(fig.setAddedAt) {
                    fmtDatum(fig.setAddedAt, zweistelligesJahr = true)
                }
                if (dateLabel != null)
                    Text(dateLabel, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * Eine Figur als Tabellenzeile: Bild, Nummer, Name, Menge, Erfassungsdatum — was
 * die Tabelle der Webapp zeigt (renderFigs in 06-minifigs.js). Keine Spalten
 * „Quelle“ und Papierkorb: Diese Liste lädt nur `source=set`, beide wären
 * konstant.
 */
@Composable
fun MinifigTableRow(fig: Minifig, serverUrl: String, imageLoader: ImageLoader,
                    onClick: (() -> Unit)? = null) {
    val (bildUrl, onFehler) = rememberTileImageWithFallback(
        serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    TabellenZeile(
        bildUrl = bildUrl,
        nummer = fig.figNumber,
        name = fig.figName,
        menge = fig.totalQuantity ?: fig.quantity,
        imageLoader = imageLoader,
        zweiteZeile = fmtDatum(fig.setAddedAt),
        onBildFehler = onFehler,
        onClick = onClick,
    )
}
