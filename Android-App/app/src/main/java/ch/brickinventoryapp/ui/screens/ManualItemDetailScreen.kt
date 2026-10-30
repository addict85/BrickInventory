package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.theme.BrickStatTile
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Petrol
import ch.brickinventoryapp.util.resolveFullUrlViaProxy
import coil3.ImageLoader
import coil3.compose.AsyncImage
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ViewInAr

/**
 * Detailansicht eines manuell erfassten Teils / einer Minifigur — als ganzer
 * Screen wie bei den Sets, weil der Inhalt (Bild, Mengenwahl, Kaufpreise und
 * Marktpreise je Zustand, Preisverlauf, Löschen) für einen AlertDialog zu lang
 * ist. Derselbe Aufbau wie SetDetailScreen, damit man beim Wechsel vom Set zum
 * Teil dieselben Dinge an denselben Stellen findet.
 *
 * Erfassungen und Preisverlauf lädt `loadManualAcquisitions()`. Der Screen liest
 * seine Zustände direkt vom ViewModel wie AcquisitionManagementScreen — bei sechs
 * Zuständen und ebenso vielen Rückrufen wäre die Parameterliste länger als der
 * Screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualItemDetailScreen(
    vm: KaeufeViewModel,
    /** Die Zeile des Eintrags und das Ändern, Löschen, Umfärben. */
    teile: TeileViewModel,
    type: String,          // "part" | "fig"
    id: String,            // partNumber / figNumber
    colorId: Int = ch.brickinventoryapp.data.model.KEINE_FARBE,
    /** Aus der Navigation — bis die Bewertung geladen ist, steht er in der Leiste. */
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit,
    /**
     * Die Farbe wurde geändert — der Screen muss mit der neuen Farbe neu geöffnet
     * werden: Sie ist Teil der Kennung (Route
     * manual_detail/{type}/{id}/{colorId}/{title}) und der Suche unten (`it.colorId ==
     * colorId`); sonst stünde er leer da, obwohl die Änderung geklappt hat. Vorgabe
     * leer, weil eine Figur keine Farbe hat.
     */
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val partsState by teile.partsState.collectAsStateWithLifecycle()
    val manDetailState by vm.manDetailState.collectAsStateWithLifecycle()
    // Der Vorrat an Lagerorten fuer das Feld weiter unten.
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()

    val isFig = type == "fig"
    val currency = state.currency

    LaunchedEffect(type, id, colorId) {
        vm.loadManualAcquisitions(type, id, colorId)
        // Die Liste kann fehlen, wenn der Screen aus einem Tiefenlink oder nach einem
        // Prozessneustart kommt — ohne sie gäbe es weder Name noch Bild. Aus derselben
        // Quelle wie die Liste (/parts/manual bzw. /minifigs/manual), damit es für
        // dieselbe Zeile nur eine Quelle gibt und keine Marktpreise für den ganzen Bestand
        // geholt werden.
        if (partsState.manualParts == null && partsState.manualFigs == null) {
            if (isFig) teile.loadMinifigs() else teile.loadParts()
        }
        // Die Farbliste fuer die Auswahl weiter unten. Dieselbe Quelle wie im
        // Erfassungsdialog (/parts/brick-colors) — und nur fuer Teile: Eine
        // Figur hat keine Farbe.
        if (!isFig && partsState.partsColors.isEmpty()) teile.loadPartsColors()
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
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { showDeleteConfirm = true }) {
                        Icon(Icons.Default.Delete, stringResource(
                            if (isFig) R.string.common_delete else R.string.common_delete))
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
            contentPadding = PaddingValues(bottom = Abstaende.sehrGross),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {

            // ── Bildkarte ──────────────────────────────────────────────────────
            item {
                Card(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
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
                                .clickable(role = Role.Button) { showImageZoom = true }
                                .padding(Abstaende.mittel),
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
                            LeerSymbol(if (isFig) Icons.Default.Person else Icons.Default.ViewInAr, 42.dp,
                                MaterialTheme.colorScheme.onPrimaryContainer)
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
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    contentPadding = PaddingValues(horizontal = Abstaende.gross),
                    modifier = Modifier.padding(bottom = Abstaende.mittel)
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
                        Modifier.fillMaxWidth().padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
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
                            container = ch.brickinventoryapp.ui.theme.LocalSteinDekor.current.schiefer,
                            onContainer = ch.brickinventoryapp.ui.theme.LocalSteinDekor.current.aufSchiefer,
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
                        Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(stringResource(R.string.common_quantity),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                            FilledTonalIconButton(
                                onClick = {
                                    if (qty > 1) {
                                        qty--
                                        // owner: Besitzer der KARTE. Im Haushalt zeigt
                                        // der manuelle Bereich die Eintraege aller
                                        // Konten; ohne die Angabe schreibt der Server
                                        // in die Zeile des Aufrufers.
                                        if (isFig) teile.updateMinifig(id, qty, fig?.unitPrice, fig?.blFigNumber, owner = fig?.userId)
                                        else teile.updatePart(id, colorId, qty, part?.unitPrice, part?.condition, owner = part?.userId)
                                    }
                                },
                                shape = Formen.etikett
                            ) { Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(14.dp)) }
                            Text("$qty", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.widthIn(min = 24.dp), textAlign = TextAlign.Center)
                            FilledTonalIconButton(
                                onClick = {
                                    qty++
                                    if (isFig) teile.updateMinifig(id, qty, fig?.unitPrice, fig?.blFigNumber, owner = fig?.userId)
                                    else teile.updatePart(id, colorId, qty, part?.unitPrice, part?.condition, owner = part?.userId)
                                },
                                shape = Formen.etikett
                            ) { Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(14.dp)) }
                        }
                    }

                    // ── Farbe (nur Teile) — änderbar ──
                    //
                    // Für den Fall, dass die Farbe falsch geladen wurde. Das Feld steht immer da,
                    // auch ohne Farbnamen — gerade dieses Teil ist das, das korrigiert werden muss.
                    if (!isFig) {
                        HorizontalDivider(Modifier.padding(vertical = Abstaende.winzig),
                            color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.detail_color),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            FarbWahlFeld(
                                farben = partsState.partsColors,
                                aktuell = colorId,
                                aktuellerName = part?.colorName,
                                aktuellerHex = part?.colorHex,
                                onWahl = { c ->
                                    teile.setzeTeilFarbe(id, colorId, c.id, c.name, c.hex,
                                        owner = part?.userId, onFertig = onFarbeGeaendert)
                                },
                                modifier = Modifier.padding(start = Abstaende.gross)
                                    .widthIn(max = 180.dp),
                            )
                        }
                    }

                    HorizontalDivider(Modifier.padding(vertical = Abstaende.winzig),
                        color = MaterialTheme.colorScheme.outlineVariant)

                    // ── Lagerort ──
                    //
                    // Dasselbe Bedienelement und derselbe entprellte Weg wie im Set-Detail und im
                    // Dialog der Teile aus Sets; nur die Adresse hängt am Typ, weil eine Figur
                    // keine Farbe hat.
                    Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.detail_storage),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        LagerortFeld(
                            wert = (if (isFig) fig?.storage else part?.storage) ?: "",
                            // Der VORRAT, nicht die belegten Orte: Auch ein
                            // leeres Regal soll zur Wahl stehen.
                            vorrat = lagerZustand.eigene.map { it.name },
                            onWert = { vm.setzeManuellenLagerort(type, id, colorId, it) },
                            modifier = Modifier.padding(start = Abstaende.gross)
                                .widthIn(max = 180.dp),
                        )
                    }

                    HorizontalDivider(Modifier.padding(vertical = Abstaende.winzig),
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

            // ── Marktpreis je Zustand und Verlauf ──
            //
            // Der Ladezustand gehört in die Bedingung: Sonst erschiene der Abschnitt erst mit
            // der Antwort, und bis dahin wäre „lädt noch“ nicht von „keine Marktpreise“ zu
            // unterscheiden — wie setPriceLoading in SetDetailSections.kt.
            val history = manDetailState.priceHistory
            val byCond  = history?.byCondition
            val chart   = history?.chart
            val laedt   = manDetailState.priceHistoryLoading
            if (byCond?.present()?.isNotEmpty() == true || chart?.values?.isNotEmpty() == true || laedt) {
                item {
                    SectionCard(title = stringResource(R.string.detail_section_market)) {
                        if (laedt && history == null) {
                            PreisLaedtZeile()
                        }
                        byCond?.takeIf { it.present().isNotEmpty() }?.let {
                            MarketPriceByCondition(it, currency)
                        }
                        chart?.takeIf { it.values.isNotEmpty() }?.let {
                            Spacer(Modifier.height(Abstaende.klein))
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
                        if (isFig) teile.deleteMinifig(id, fig?.userId)
                        else teile.deletePart(id, colorId, part?.userId)
                        // Der Eintrag ist weg — dieser Screen zeigte sonst eine
                        // Karteileiche mit Mengenwahl und Kaufpreisen.
                        onBack()
                    }) {
                        Text(stringResource(if (isFig) R.string.common_delete else R.string.common_delete),
                            color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showDeleteConfirm = false }) {
                        Text(stringResource(if (isFig) R.string.common_cancel else R.string.common_cancel))
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
