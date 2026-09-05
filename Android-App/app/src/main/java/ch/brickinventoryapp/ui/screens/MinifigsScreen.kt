package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.data.model.Minifig
import ch.brickinventoryapp.util.fmtInt
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.util.fmtDatum
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil.compose.AsyncImage
import coil.ImageLoader
import coil.request.ImageRequest
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSets, setScope, …)
import ch.brickinventoryapp.util.NumericInput

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MinifigsScreen(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    /** Öffnet die Detailansicht — nur der Graph kennt den NavController. */
    onOpenDetail: (figNumber: String) -> Unit = { _ -> },
    /** Scroll-Zustand von aussen, siehe Nachtrag 92. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    // Zustand und Aktionen vom ViewModel statt über fünfzehn Parameter — die
    // Begründung steht bei PartsScreen (Nachtrag 96). Die Namen bleiben
    // absichtlich dieselben, damit der Rumpf darunter unverändert bleibt.
    val state by vm.state.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()

    val figs = partsState.minifigs
    val minifigStats = partsState.minifigStats
    val isLoading = partsState.minifigsLoading
    val serverUrl = state.serverUrl
    val waehrung = state.currency
    val defaultCondition = state.userDefaultCondition ?: "N"
    val householdMembers = state.householdMembers
    val scopeMode = state.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.MINIFIGS.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    val manualFigs = partsState.manualFigs ?: emptyList()

    val onRefresh: () -> Unit = { vm.loadMinifigs() }
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.MINIFIGS, it) }
    // Besitzer der Karte mitgeben: Im Haushalt stehen hier die Eintraege aller
    // Konten. Ohne die Angabe loescht der Server die Zeile des Aufrufers —
    // geklickt waere die fremde Karte, weg die eigene.
    val onDeleteFig: (String, Int?) -> Unit = { figNumber, owner -> vm.deleteMinifig(figNumber, owner) }
    val onAddMinifig: (String, String?, Int, String?, Double?, String?, Int?) -> Unit =
        { num, blNum, qty, note, unitPrice, cond, owner ->
            vm.addMinifig(num, blNum, qty, note, unitPrice, cond, owner)
        }

    // Suchtext aus dem Zustand, gefiltert wird auf dem SERVER — wie bei den
    // Teilen (PartsScreen) und in der Galerie. Hier stand ein eigenes
    // `filter { contains(search) }` ueber die schon geladene Liste; damit
    // existierte die Suchregel zweimal, und sie traf etwas anderes als die des
    // Servers (Begruendung in TeileRepository.getMinifigs).
    //
    // remember(partsState.minifigsQuery): Das Feld haelt den Text waehrend des
    // Tippens selbst, uebernimmt aber einen von aussen gesetzten (Leeren beim
    // Abmelden, Wiederherstellen). Genau wie in PartsScreen.
    var search by remember(partsState.minifigsQuery) { mutableStateOf(partsState.minifigsQuery) }
    val ansicht = partsState.minifigsView
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var deletingFig by remember { mutableStateOf<FigValuationItem?>(null) }

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
        // ── Warum die Bedingung nicht mehr `figs.isNotEmpty()` ist ──────────────
        //
        // Hier stand `if (figs.isNotEmpty())`: Die Leiste erschien nur, wenn die
        // GELADENE Seite Figuren enthielt. Eine Suche ohne Treffer liess sie
        // also verschwinden — obwohl die drei Zahlen die ganze Sammlung meinen
        // und weiter stimmen. Genau das sagt der Kommentar darunter seit jeher:
        // „vom Server, nicht aus der (gefilterten) Liste".
        //
        // Die Teile-Ansicht daneben — derselbe Aufbau, dieselbe Leiste — prueft
        // `stats != null` und laesst sie stehen. Die Webapp auch: Dort ist die
        // Leiste fester Bestandteil der Seite und wird nur gefuellt
        // (06-minifigs.js, loadMinifigStats).
        //
        // `partsStats` ist im Zustand nullbar, `minifigStats` nicht — deshalb
        // hier die Frage nach dem Inhalt statt nach null. Wirkung ist dieselbe:
        // verborgen bleibt die Leiste nur vor dem ersten Laden und bei einer
        // wirklich leeren Sammlung.
        if (minifigStats.types > 0 || minifigStats.totalQuantity > 0) {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Zahlen vom Server (utils/handlers.ts, getMinifigStats) — aus der
                    // Liste gerechnet zählten sie die manuell erfassten Figuren nicht
                    // mit, weil die hier ausgefiltert sind; die Kachel „manuell" stand
                    // dadurch zwangsläufig immer auf 0.
                    GalleryStatChip(fmtInt(minifigStats.types), stringResource(R.string.minifigs_stat_types))
                    GalleryStatChip(fmtInt(minifigStats.totalQuantity), stringResource(R.string.minifigs_stat_total))
                    GalleryStatChip(fmtInt(minifigStats.manual), stringResource(R.string.minifigs_stat_manual))
                }
            }
        }

        // Suchfeld — gemeinsamer Baustein. Der Leeren-Knopf sagte hier
        // „Löschen" (minifigs_delete, derselbe Text wie am Loeschknopf der
        // Minifigur); jetzt „Suche leeren" (Nachtrag 132).
        Suchfeld(
            wert = search,
            onWert = { search = it; vm.setMinifigsQuery(it) },
            platzhalter = stringResource(R.string.minifigs_search_placeholder),
        )

        // Karten oder Tabelle — wie das Auswahlfeld figs-view der Webapp.
        AnsichtUmschalter(
            aktuell = ansicht,
            onWechsel = { vm.setMinifigsView(it) },
            modifier = Modifier.padding(horizontal = 14.dp).padding(bottom = 8.dp),
        )

        when {
            isLoading && figs.isEmpty() && manualFigs.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator()
            }
            figs.isEmpty() && manualFigs.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("👷", fontSize = 40.sp)
                    Text(stringResource(R.string.minifigs_none), fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.minifigs_loaded_on_import),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            figs.isEmpty() && manualFigs.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("🔍", fontSize = 40.sp)
                    Text(stringResource(R.string.minifigs_no_results), fontWeight = FontWeight.SemiBold)
                }
            }
            else -> PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(140.dp),
                    state = gridState,
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Manuelle Figuren als Grid-Sektion — eine durchgehende
                    // Scroll-Liste statt fixem Block über dem Grid (s. PartsScreen).
                    if (manualFigs.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "manual-header") {
                            SectionHeader(stringResource(R.string.minifigs_manual_section))
                        }
                        items(manualFigs, key = { "manual-${it.id ?: it.figNumber}" }) { fig ->
                            ManualFigTile(
                                fig = fig,
                                serverUrl = serverUrl,
                                imageLoader = imageLoader,
                                waehrung = waehrung,
                                onEdit = { onOpenDetail(fig.figNumber) },
                                onDelete = { deletingFig = fig }
                            )
                        }
                        if (figs.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "sets-header") {
                                SectionHeader(stringResource(R.string.minifigs_sets_section))
                            }
                        }
                    }
                    // Wie bei den Teilen: In der Tabellenansicht nimmt jede
                    // Zeile die ganze Breite, der Raster-Container bleibt
                    // derselbe. Die manuellen Figuren bleiben in beiden
                    // Ansichten Kacheln — dort haengt in der Webapp
                    // #manual-figs-list ebenfalls nicht an figs-view.
                    itemsIndexed(
                        figs,
                        key = { index, fig -> "${fig.figNumber}_${fig.source}_$index" },
                        span = { _, _ -> if (ansicht == "table") GridItemSpan(maxLineSpan) else GridItemSpan(1) },
                    ) { _, fig ->
                        // BEIDE Ansichten oeffnen denselben Dialog.
                        val oeffne = { vm.oeffneSetItem("fig", fig.figNumber) }
                        if (ansicht == "table") MinifigTableRow(fig, serverUrl, imageLoader, oeffne)
                        else MinifigCard(fig, serverUrl, imageLoader, oeffne)
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

    if (showAddDialog) {
        AddMinifigDialog(
            householdMembers = householdMembers,
            defaultCondition = defaultCondition,
            onDismiss = { showAddDialog = false },
            onAdd = { num, blNum, qty, note, unitPrice, cond, owner ->
                showAddDialog = false
                onAddMinifig(num, blNum, qty, note, unitPrice, cond, owner)
            }
        )
    }

    deletingFig?.let { fig ->
        AlertDialog(
            onDismissRequest = { deletingFig = null },
            icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text(stringResource(R.string.minifigs_delete_title)) },
            text = { Text(stringResource(R.string.minifigs_delete_text, fig.figName ?: fig.figNumber)) },
            confirmButton = {
                TextButton(onClick = { onDeleteFig(fig.figNumber, fig.userId); deletingFig = null }) {
                    Text(stringResource(R.string.minifigs_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deletingFig = null }) { Text(stringResource(R.string.minifigs_cancel)) } }
        )
    }
}

@Composable
fun ManualFigTile(fig: FigValuationItem, serverUrl: String, imageLoader: ImageLoader,
                  waehrung: String, onEdit: () -> Unit, onDelete: () -> Unit) {
    val ctx = LocalContext.current

    Card(
        onClick = onEdit,  // ganze Karte klickbar — öffnet den Kaufpreis/Anzahl-Dialog, analog Sets
        modifier = Modifier.width(Formen.kachelBreite).height(Formen.kachelHoehe),
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(76.dp)) {
                // Vorschaubild mit Rückfall auf volle Auflösung — siehe
                // util/ImageUrls.kt, rememberTileImageWithFallback().
                val (tileImg, onImgError) = rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
                if (tileImg != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(ctx).data(tileImg).crossfade(true).build(),
                        imageLoader = imageLoader,
                        contentDescription = fig.figName,
                        onState = { st ->
                            if (st is coil.compose.AsyncImagePainter.State.Error) onImgError()
                        },
                        modifier = Modifier.fillMaxSize().clip(Formen.kachelBildEcken),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Box(Modifier.fillMaxSize(), Alignment.Center) { Text("👷", fontSize = 24.sp) }
                }
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Formen.marke,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp)
                ) {
                    // Die Menge-Plakette: „×N" auf einer MANUELL erfassten Kachel,
                    // „N×" auf einer Kachel aus einem Set. Das ist keine Laune,
                    // sondern die Regel der Webapp — `man-tile` traegt dort ein
                    // `qbadge` mit ×N, `part-card` ein `part-qty` mit N×.
                    Text("×${fig.quantity}", Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                Row(Modifier.align(Alignment.TopStart).padding(2.dp)) {
                    IconButton(onClick = onEdit, modifier = Modifier.size(24.dp)) {
                        Icon(Icons.Default.Edit, stringResource(R.string.minifigs_edit), Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
                IconButton(onClick = onDelete, modifier = Modifier.align(Alignment.BottomEnd).size(24.dp)) {
                    Icon(Icons.Default.Delete, stringResource(R.string.minifigs_delete), Modifier.size(14.dp), tint = MaterialTheme.colorScheme.error)
                }
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = 4.dp)) {
                Text(fig.figName ?: fig.figNumber, style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                // ── Was hier fehlte (Nachtrag 133) ──────────────────────────
                //
                // Diese Kachel zeigte NUR den Namen. Ihr Zwilling nebenan,
                // ManualPartTile in PartsScreen.kt, zeigt beide Plaketten seit
                // jeher — und die Webapp zeigt sie fuer Figuren genauso
                // (06-minifigs.js Zeile 327: qbadge, dann condBadge, dann
                // ownerBadges).
                //
                // FigValuationItem traegt `condition`, `conditions` und
                // `owners` die ganze Zeit; die Felder sind im Modell sogar
                // kommentiert. Im Haushalt war an einer Figur also nicht zu
                // sehen, WEM sie gehoert — bei den Teilen daneben schon.
                //
                // Gefunden nicht durch Lesen, sondern durch den Vergleich der
                // beiden Zwillingsdateien, den die Doppelungsmessung angestossen
                // hat.
                Box(Modifier.padding(top = 3.dp)) { ConditionBadges(fig.conditions, fig.condition) }
                OwnerBadges(fig.owners, Modifier.padding(top = 2.dp))
                ManuelleKachelFuss(
                    preis = fig.avgPurchasePrice ?: fig.unitPrice ?: fig.purchasePrice,
                    waehrung = waehrung,
                    notiz = fig.note,
                )
            }
        }
    }
}

@Composable
fun AddMinifigDialog(
    onDismiss: () -> Unit,
    onAdd: (String, String?, Int, String?, Double?, String?, Int?) -> Unit,
    defaultCondition: String = "N",
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList()
) {
    var figNumber  by rememberSaveable { mutableStateOf("") }
    var blFigNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    var note       by rememberSaveable { mutableStateOf("") }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }


    fun submit() {
        if (figNumber.isNotBlank()) {
            onAdd(
                figNumber,
                blFigNumber.trim().ifBlank { null },
                quantity.toIntOrNull() ?: 1,
                note.ifBlank { null },
                unitPrice.replace(',', '.').toDoubleOrNull(),
                condition,
                if (householdMembers.size > 1) owner else null
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
                OutlinedTextField(
                    value = quantity, onValueChange = { quantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.minifigs_quantity)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    value = unitPrice, onValueChange = { unitPrice = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.minifigs_unit_price)) }, placeholder = { Text(stringResource(R.string.minifigs_unit_price_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.preisTastatur()
                )
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text(stringResource(R.string.minifigs_note)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf
                )
                Zustandszeile(zustand = condition, onZustand = { condition = it })
            }
        },
        confirmButton = { TextButton(onClick = { submit(); onDismiss() }) { Text(stringResource(R.string.minifigs_add_button)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.minifigs_cancel)) } }
    )
}

@Composable
fun MinifigCard(fig: Minifig, serverUrl: String, imageLoader: ImageLoader,
                onClick: (() -> Unit)? = null) {
    val qty = fig.totalQuantity ?: fig.quantity

    Card(
        // Antippen oeffnet den Detail-Dialog — wie bei den Teilen daneben.
        modifier = Modifier.fillMaxWidth().height(196.dp)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
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
                            if (st is coil.compose.AsyncImagePainter.State.Error) onFigImgError()
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
                        Box(Modifier.fillMaxSize(), Alignment.Center) { Text("👷", fontSize = 36.sp) }
                    }
                }
                if (qty > 1) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
                    ) {
                        // Die Menge-Plakette: „×N" auf einer MANUELL erfassten Kachel,
                        // „N×" auf einer Kachel aus einem Set. Das ist keine Laune,
                        // sondern die Regel der Webapp — `man-tile` traegt dort ein
                        // `qbadge` mit ×N, `part-card` ein `part-qty` mit N×.
                        Text("$qty×", Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
                // Zustand nur bei manuell erfassten Minifiguren (automatisch aus
                // Sets übernommene haben keinen eigenen Zustand). Die
                // BESITZER-Plakette dagegen unbedingt: Sie beantwortet „wem
                // gehört das?", und die Frage stellt sich bei einer Figur aus
                // dem Set eines Kindes genauso. Die Galerie-Kachel zeigt sie
                // seit jeher.
                //
                // Sie stand INNERHALB dieser Bedingung — und diese Liste lädt
                // ausschliesslich `source=set`. Die Plakette war also
                // unerreichbar. Ohne Haushalt ist `owners` leer, und
                // OwnerBadges kehrt dann sofort zurück; im Einzelkonto ändert
                // sich nichts.
                //
                // Column statt Box: Zwei Plaketten übereinander, nicht
                // aufeinander — in einer Box lägen sie am selben Punkt.
                Column(Modifier.align(Alignment.BottomStart).padding(4.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (fig.source == "manual") ConditionBadges(fig.conditions, fig.condition)
                    OwnerBadges(fig.owners)
                }
                if (fig.source == "manual") {
                    Surface(
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopStart).padding(4.dp)
                    ) {
                        Text(stringResource(R.string.minifigs_manual_badge), Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(fig.figNumber, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                Text(fig.figName ?: fig.figNumber,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                // Gemeinsamer Helfer (util/DatumFormat.kt). Hier stand ein
                // SimpleDateFormat mit dem festen Muster
                // "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" — bei einem Zeitstempel OHNE
                // Millisekunden fiel es still auf null zurueck, und dann stand
                // gar kein Datum da.
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
 * Eine Figur als Tabellenzeile.
 *
 * Zeigt, was die Tabelle der Webapp zeigt (renderFigs in 06-minifigs.js):
 * Bild, Nummer, Name, Menge, Erfassungsdatum.
 *
 * Die Spalten „Quelle" und Papierkorb, die dort einmal standen, sind es
 * nicht — beide waren konstant, weil diese Liste ausschliesslich `source=set`
 * laedt. Sie sind im selben Zug auch in der Webapp entfernt worden; hier steht
 * also nicht weniger, sondern in beiden dasselbe.
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
