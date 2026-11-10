package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.zustand.ui.ManualItemDetailUiState
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.teile.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeAktionen
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.model.ui.model.OHNE_FARBE
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.gemeinsam.ui.AcquisitionSummarySection
import ch.brickinventoryapp.gemeinsam.ui.KennzahlenReihe
import ch.brickinventoryapp.gemeinsam.ui.LagerortFeld
import ch.brickinventoryapp.gemeinsam.ui.MarketPriceByCondition
import ch.brickinventoryapp.gemeinsam.ui.PreisLaedtZeile
import ch.brickinventoryapp.gemeinsam.ui.PriceChart
import ch.brickinventoryapp.gemeinsam.ui.SectionCard
import ch.brickinventoryapp.gemeinsam.ui.StatChipV2
import ch.brickinventoryapp.gemeinsam.ui.WertKacheln

/**
 * Detailansicht eines manuell erfassten Teils / einer Minifigur — als ganzer Screen wie bei
 * den Sets, weil der Inhalt (Bild, Mengenwahl, Kaufpreise und Marktpreise je Zustand,
 * Preisverlauf, Löschen) für einen AlertDialog zu lang ist.
 * Ausführlich: docs/begruendungen/feature-teile/teile/ui/screens/ManualItemDetailScreen.kt.md#manualitemdetailroute
 */
@Composable
fun ManualItemDetailRoute(
    vm: KaeufeViewModel,
    teile: TeileViewModel,
    type: Postenart,
    id: String,
    colorId: Int = OHNE_FARBE,
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit,
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val partsState by teile.partsState.collectAsStateWithLifecycle()
    val manDetailState by vm.manDetailState.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    ManualItemDetailScreen(
        zustand = EinzelstueckZustand(state, partsState, manDetailState, lagerZustand),
        kaeufe = vm, teile = teile, type = type, id = id, colorId = colorId,
        fallbackTitle = fallbackTitle, imageLoader = imageLoader, onBack = onBack,
        onNavigateToAcqMgmt = onNavigateToAcqMgmt, onFarbeGeaendert = onFarbeGeaendert,
    )
}

/** Was die Detailansicht eines manuellen Eintrags zeigt. */
internal data class EinzelstueckZustand(
    val state: AppUiState,
    val partsState: PartsUiState,
    val manDetailState: ManualItemDetailUiState,
    val lagerZustand: LagerUiState,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManualItemDetailScreen(
    zustand: EinzelstueckZustand,
    kaeufe: KaeufeAktionen,
    /** Die Zeile des Eintrags und das Ändern, Löschen, Umfärben. */
    teile: TeileAktionen,
    type: Postenart,
    id: String,            // partNumber / figNumber
    colorId: Int = OHNE_FARBE,
    /** Aus der Navigation — bis die Bewertung geladen ist, steht er in der Leiste. */
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit,
    /**
     * Die Farbe wurde geändert — der Screen muss mit der neuen Farbe neu geöffnet
     * werden: Sie ist Teil der Kennung (Route
     * manual_detail/{type}/{id}/{colorId}/{title}) und der Suche unten (`it.colorId ==
     * colorId`); sonst stünde er leer da, obwohl die Änderung geklappt hat. Vorgabe
     * leer, weil eine Figur keine Farbe hat.
     */
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
) {
    val state = zustand.state
    val partsState = zustand.partsState
    val manDetailState = zustand.manDetailState
    val lagerZustand = zustand.lagerZustand

    val isFig = type == Postenart.FIG
    val currency = state.currency

    LaunchedEffect(type, id, colorId) {
        kaeufe.loadManualAcquisitions(type, id, colorId)
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

    val akzent = LocalAkzentflaechen.current
    Scaffold(
        topBar = {
            // Derselbe Kopf wie jedes Detail (DetailTopAppBar).
            DetailTopAppBar(
                titel = title,
                onZurueck = onBack,
                farben = TopAppBarDefaults.topAppBarColors(
                    containerColor = akzent.detailLeiste,
                    titleContentColor = akzent.aufDetailLeiste,
                    navigationIconContentColor = akzent.aufDetailLeiste,
                    actionIconContentColor = akzent.aufDetailLeiste,
                ),
                actions = {
                    MitTooltip(stringResource(R.string.common_delete)) {
                        IconButton(onClick = { showDeleteConfirm = true }) {
                            Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                        }
                    }
                },
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
                BildKarte(imageUrl, imageLoader, title, onZoom = { showImageZoom = true })
            }

            // ── Kennzahlen-Chips ───────────────────────────────────────────────
            item {
                val labelNumber = stringResource(
                    if (isFig) R.string.detail_fig_number else R.string.detail_part_number)
                val labelColor  = stringResource(R.string.detail_color)
                val farbe = farbUebersetzer()
                val chips = buildList {
                    add(labelNumber to id)
                    part?.colorName?.let { add(labelColor to farbe(it)) }
                    fig?.blFigNumber?.let { add("BrickLink" to it) }
                }
                KennzahlenReihe(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel)) {
                    chips.forEach { (label, value) -> StatChipV2(label = label, value = value) }
                }
            }

            // ── Wert-Kacheln wie im Set-Detail, in jedem Design ───────────────
            item {
                fun fmt(v: Double?) = if (v == null) "—"
                    else fmtMoney(v, currency)
                WertKacheln(
                    markt = fmt(fig?.avgPrice ?: part?.avgPrice),
                    kauf = fmt(fig?.purchasePrice ?: part?.purchasePrice),
                    pnl = fig?.pnlProzent ?: part?.pnlProzent,
                    modifier = Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
                )
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

                    MengenZeile(
                        menge = qty,
                        onWeniger = {
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
                        onMehr = {
                            qty++
                            if (isFig) teile.updateMinifig(id, qty, fig?.unitPrice, fig?.blFigNumber, owner = fig?.userId)
                            else teile.updatePart(id, colorId, qty, part?.unitPrice, part?.condition, owner = part?.userId)
                        },
                    )

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
                            onWert = { kaeufe.setzeManuellenLagerort(type, id, colorId, it) },
                            modifier = Modifier.padding(start = Abstaende.gross)
                                .weight(1f).widthIn(max = 320.dp),
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
                            PriceChart(it, currency)
                        }
                    }
                }
            }
        }

        if (showDeleteConfirm) {
            LoeschenFrage(
                isFig = isFig,
                title = title,
                onSchliessen = { showDeleteConfirm = false },
                onLoeschen = {
                    showDeleteConfirm = false
                    // Auch hier der Besitzer der Karte — sonst loescht der
                    // Server die Zeile des Aufrufers statt der angezeigten.
                    if (isFig) teile.deleteMinifig(id, fig?.userId)
                    else teile.deletePart(id, colorId, part?.userId)
                    // Der Eintrag ist weg — dieser Screen zeigte sonst eine
                    // Karteileiche mit Mengenwahl und Kaufpreisen.
                    onBack()
                },
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

/** Das Bild des Teils oder der Figur; ein Tipp öffnet es gross. */
@Composable
private fun BildKarte(imageUrl: String?, imageLoader: ImageLoader, title: String, onZoom: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
        shape = Formen.chip,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        ProduktBild(
            model = imageUrl,
            imageLoader = imageLoader,
            contentDescription = title,
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp)
                .clip(Formen.chip)
                .clickable(enabled = imageUrl != null, onClickLabel = stringResource(R.string.cd_bild_vergroessern), role = Role.Button, onClick = onZoom)
                .padding(Abstaende.mittel),
            contentScale = ContentScale.Fit,
            ersatzGroesse = 64.dp,
        )
    }
}

/** Menge mit Minus und Plus; was eine Änderung schreibt, entscheidet der Aufrufer. */
@Composable
private fun MengenZeile(menge: Int, onWeniger: () -> Unit, onMehr: () -> Unit) {
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
            MitTooltip(stringResource(R.string.cd_qty_decrease)) {
                FilledTonalIconButton(
                    onClick = onWeniger,
                    shape = Formen.etikett
                ) { Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(mitSchrift(14.dp))) }
            }
            Text("$menge", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(min = 24.dp), textAlign = TextAlign.Center)
            MitTooltip(stringResource(R.string.cd_qty_increase)) {
                FilledTonalIconButton(
                    onClick = onMehr,
                    shape = Formen.etikett
                ) { Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(mitSchrift(14.dp))) }
            }
        }
    }
}

/** Rückfrage vor dem Löschen des Teils bzw. der Figur. */
@Composable
private fun LoeschenFrage(isFig: Boolean, title: String, onSchliessen: () -> Unit, onLoeschen: () -> Unit) {
    AlertDialog(
        onDismissRequest = onSchliessen,
        icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
        title = { Text(stringResource(
            if (isFig) R.string.minifigs_delete_title else R.string.parts_delete_title)) },
        text = { Text(stringResource(
            if (isFig) R.string.minifigs_delete_text else R.string.parts_delete_text, title)) },
        confirmButton = {
            TextButton(onClick = onLoeschen) {
                Text(stringResource(R.string.common_delete),
                    color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onSchliessen) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
