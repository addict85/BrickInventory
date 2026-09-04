package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.deleteMinifig
import ch.brickinventoryapp.ui.deletePart
import ch.brickinventoryapp.ui.loadManualAcquisitions
import ch.brickinventoryapp.ui.loadMinifigs
import ch.brickinventoryapp.ui.loadParts
import ch.brickinventoryapp.ui.updateMinifig
import ch.brickinventoryapp.ui.updatePart
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.theme.BrickStatTile
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Petrol
import ch.brickinventoryapp.ui.theme.SlateBlue
import ch.brickinventoryapp.util.resolveFullUrlViaProxy
import coil.ImageLoader
import coil.compose.AsyncImage

/**
 * Detailansicht eines manuell erfassten Teils / einer manuell erfassten
 * Minifigur — als ganzer Screen, wie bei den Sets.
 *
 * ── Warum kein Dialog mehr ──────────────────────────────────────────────────
 * Der Inhalt ist über die letzten Runden gewachsen: Bild, Mengenwahl,
 * Kaufpreise je Zustand, Marktpreis je Zustand, Preisverlauf, Löschen. Ein
 * AlertDialog schneidet zu langen Inhalt unten ab; abgefangen war das zuletzt
 * nur noch durch einen eigenen Scrollbereich IM Dialog — also ein Screen im
 * Kostüm eines Dialogs, mit dem halben Bildschirm als Rand.
 *
 * Jetzt derselbe Aufbau wie SetDetailScreen: Leiste mit Zurück-Pfeil und
 * Papierkorb, darunter eine LazyColumn mit Bildkarte, Kennzahlen-Chips und
 * Abschnittskarten. Wer vom Set zum Teil wechselt, findet dieselben Dinge an
 * denselben Stellen.
 *
 * ── Woher die Daten kommen ──────────────────────────────────────────────────
 * Stammdaten aus der Bewertung (`partsValuation`/`figsValuation`) — sie trägt
 * bereits Name, Farbe, Menge, Bild und Preise. Erfassungen und Preisverlauf
 * lädt `loadManualAcquisitions()`, das den Verlaufsabruf mit anstösst.
 *
 * Der Screen liest sie direkt vom ViewModel statt sie durchgereicht zu
 * bekommen — wie AcquisitionManagementScreen. Bei sechs Zuständen und ebenso
 * vielen Rückrufen wäre die Parameterliste sonst länger als der Screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualItemDetailScreen(
    vm: MainViewModel,
    type: String,          // "part" | "fig"
    id: String,            // partNumber / figNumber
    colorId: Int = 0,
    /** Aus der Navigation — bis die Bewertung geladen ist, steht er in der Leiste. */
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val partsState by vm.partsState.collectAsStateWithLifecycle()
    val manDetailState by vm.manDetailState.collectAsStateWithLifecycle()

    val isFig = type == "fig"
    val currency = state.currency

    LaunchedEffect(type, id, colorId) {
        vm.loadManualAcquisitions(type, id, colorId)
        // Die Bewertung kann fehlen, wenn der Screen aus einem Tiefenlink oder
        // nach einem Prozessneustart kommt — ohne sie gäbe es weder Name noch
        // Bild.
        // Aus DERSELBEN Quelle wie die Liste (/parts/manual bzw.
        // /minifigs/manual). Vorher stand hier die Bewertung — also eine
        // zweite Quelle fuer dieselbe Zeile, und dafuer wurden Marktpreise
        // fuer den ganzen Bestand geholt, obwohl dieser Dialog nur Name,
        // Menge und Bild zeigt.
        if (partsState.manualParts == null && partsState.manualFigs == null) {
            if (isFig) vm.loadMinifigs() else vm.loadParts()
        }
    }

    val fig  = if (isFig) partsState.manualFigs?.find { it.figNumber == id } else null
    val part = if (!isFig) partsState.manualParts?.find {
        it.partNumber == id && it.colorId == colorId
    } else null

    val title = fig?.figName ?: part?.partName ?: fallbackTitle.ifBlank { id }
    val quantity = fig?.quantity ?: part?.quantity ?: 1
    val imageUrl = resolveFullUrlViaProxy(
        state.serverUrl, fig?.imageLocal ?: part?.imageLocal, fig?.imageUrl ?: part?.imageUrl)

    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val isBrick = LocalIsBrickTheme.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(title, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.detail_back))
                    }
                },
                actions = {
                    IconButton(onClick = { showDeleteConfirm = true }) {
                        Icon(Icons.Default.Delete, stringResource(
                            if (isFig) R.string.minifigs_delete else R.string.parts_delete))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = if (isBrick) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.surface,
                    titleContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurfaceVariant,
                    actionIconContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {

            // ── Bildkarte ──────────────────────────────────────────────────────
            item {
                Card(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    shape = Formen.chip,
                    elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    if (imageUrl != null) {
                        AsyncImage(
                            model = imageUrl,
                            imageLoader = imageLoader,
                            contentDescription = title,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp)
                                .clip(Formen.chip)
                                .clickable { showImageZoom = true }
                                .padding(12.dp),
                            contentScale = ContentScale.Fit
                        )
                    } else {
                        Box(
                            Modifier.fillMaxWidth().height(160.dp).background(
                                Brush.linearGradient(listOf(
                                    MaterialTheme.colorScheme.primaryContainer,
                                    MaterialTheme.colorScheme.secondaryContainer))),
                            Alignment.Center
                        ) {
                            Text(if (isFig) "👷" else "🧱", fontSize = 42.sp)
                        }
                    }
                }
            }

            // ── Kennzahlen-Chips ───────────────────────────────────────────────
            item {
                val labelNumber = stringResource(
                    if (isFig) R.string.detail_fig_number else R.string.detail_part_number)
                val labelColor  = stringResource(R.string.detail_color)
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    modifier = Modifier.padding(bottom = 12.dp)
                ) {
                    val chips = buildList {
                        add(labelNumber to id)
                        part?.colorName?.let { add(labelColor to it) }
                        fig?.blFigNumber?.let { add("BrickLink" to it) }
                    }
                    items(chips) { (label, value) -> StatChipV2(label = label, value = value) }
                }
            }

            // ── Stein-Design: prominente Wert-Kacheln, wie im Set-Detail ───────
            if (isBrick) {
                item {
                    fun fmt(v: Double?) = if (v == null) "—"
                        else ch.brickinventoryapp.util.fmtMoney(v, currency)
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        BrickStatTile(
                            label = stringResource(R.string.detail_section_market),
                            value = fmt(fig?.avgPrice ?: part?.avgPrice),
                            container = Petrol, onContainer = Color.White,
                            modifier = Modifier.weight(1f)
                        )
                        BrickStatTile(
                            label = stringResource(R.string.detail_purchase_price),
                            value = fmt(fig?.purchasePrice ?: part?.purchasePrice),
                            container = SlateBlue, onContainer = Color.White,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            // ── Details: Menge und Kaufpreise ──────────────────────────────────
            item {
                SectionCard(title = stringResource(R.string.detail_section_item)) {
                    // Menge folgt der Summe der Erfassungen, sobald es welche
                    // gibt — nach dem Löschen einer Erfassung stimmt der Zähler
                    // damit ohne eigenes Nachhalten.
                    val acqTotal = if (manDetailState.acquisitions.isNotEmpty())
                        manDetailState.acquisitions.sumOf { it.quantity } else quantity
                    var qty by remember(acqTotal) { mutableIntStateOf(acqTotal) }

                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(stringResource(R.string.detail_quantity),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            FilledTonalIconButton(
                                onClick = {
                                    if (qty > 1) {
                                        qty--
                                        // owner: Besitzer der KARTE. Im Haushalt zeigt
                                        // der manuelle Bereich die Eintraege aller
                                        // Konten; ohne die Angabe schreibt der Server
                                        // in die Zeile des Aufrufers.
                                        if (isFig) vm.updateMinifig(id, qty, fig?.unitPrice, fig?.blFigNumber, owner = fig?.userId)
                                        else vm.updatePart(id, colorId, qty, part?.unitPrice, part?.condition, owner = part?.userId)
                                    }
                                },
                                modifier = Modifier.size(32.dp), shape = Formen.etikett
                            ) { Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(14.dp)) }
                            Text("$qty", fontWeight = FontWeight.Bold, fontSize = 16.sp,
                                modifier = Modifier.widthIn(min = 24.dp), textAlign = TextAlign.Center)
                            FilledTonalIconButton(
                                onClick = {
                                    qty++
                                    if (isFig) vm.updateMinifig(id, qty, fig?.unitPrice, fig?.blFigNumber, owner = fig?.userId)
                                    else vm.updatePart(id, colorId, qty, part?.unitPrice, part?.condition, owner = part?.userId)
                                },
                                modifier = Modifier.size(32.dp), shape = Formen.etikett
                            ) { Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(14.dp)) }
                        }
                    }

                    HorizontalDivider(Modifier.padding(vertical = 4.dp),
                        color = MaterialTheme.colorScheme.outlineVariant)

                    // Dieselbe Zusammenfassung wie im Set-Detail — eine Zeile je
                    // Kaufpreis, Bearbeiten führt auf den Kaufpreis-Screen.
                    AcquisitionSummarySection(
                        acquisitions = manDetailState.acquisitions,
                        currency = currency,
                        onEditPrices = { onNavigateToAcqMgmt(type, id, colorId, title) }
                    )
                }
            }

            // ── Marktpreis je Zustand und Verlauf ──────────────────────────────
            //
            // Der Ladezustand gehoert MIT in die Bedingung: Ohne ihn erscheint
            // der ganze Abschnitt erst, wenn die Antwort da ist — und bis dahin
            // ist nicht zu unterscheiden, ob noch geladen wird oder ob es zu
            // diesem Teil keine Marktpreise gibt. `priceHistoryLoading` wurde
            // dafuer geschrieben, aber nirgends gelesen; die Preis-Sektion des
            // Sets macht es seit jeher richtig (setPriceLoading in
            // SetDetailSections.kt).
            val history = manDetailState.priceHistory
            val byCond  = history?.byCondition
            val chart   = history?.chart
            val laedt   = manDetailState.priceHistoryLoading
            if (byCond?.present()?.isNotEmpty() == true || chart?.values?.isNotEmpty() == true || laedt) {
                item {
                    SectionCard(title = stringResource(R.string.detail_section_market)) {
                        if (laedt && history == null) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                                Text(stringResource(R.string.detail_price_loading),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        byCond?.takeIf { it.present().isNotEmpty() }?.let {
                            MarketPriceByCondition(it, currency)
                        }
                        chart?.takeIf { it.values.isNotEmpty() }?.let {
                            Spacer(Modifier.height(8.dp))
                            PriceChart(it)
                        }
                    }
                }
            }
        }

        if (showDeleteConfirm) {
            AlertDialog(
                onDismissRequest = { showDeleteConfirm = false },
                icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                title = { Text(stringResource(
                    if (isFig) R.string.minifigs_delete_title else R.string.parts_delete_title)) },
                text = { Text(stringResource(
                    if (isFig) R.string.minifigs_delete_text else R.string.parts_delete_text, title)) },
                confirmButton = {
                    TextButton(onClick = {
                        showDeleteConfirm = false
                        // Auch hier der Besitzer der Karte — sonst loescht der
                        // Server die Zeile des Aufrufers statt der angezeigten.
                        if (isFig) vm.deleteMinifig(id, fig?.userId)
                        else vm.deletePart(id, colorId, part?.userId)
                        // Der Eintrag ist weg — dieser Screen zeigte sonst eine
                        // Karteileiche mit Mengenwahl und Kaufpreisen.
                        onBack()
                    }) {
                        Text(stringResource(if (isFig) R.string.minifigs_delete else R.string.parts_delete),
                            color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showDeleteConfirm = false }) {
                        Text(stringResource(if (isFig) R.string.minifigs_cancel else R.string.parts_cancel))
                    }
                }
            )
        }

        if (showImageZoom && imageUrl != null) {
            ZoomableImageDialog(
                imageUrl = imageUrl,
                contentDescription = title,
                imageLoader = imageLoader,
                onDismiss = { showImageZoom = false }
            )
        }
    }
}
