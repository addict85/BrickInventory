package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.runtime.remember
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.parts.ui.MinifigsUiState
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.parts.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.parts.ui.viewmodel.FigurenAktionen
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import ch.brickinventoryapp.ui.components.Prompt
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.QuantitiesButton
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.farbTranslator
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.shared.ui.AcquisitionSummarySection
import ch.brickinventoryapp.shared.ui.LocationField
import ch.brickinventoryapp.shared.ui.MarketPriceByCondition
import ch.brickinventoryapp.shared.ui.PriceLoadsRow
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.shared.ui.SectionCard
import ch.brickinventoryapp.shared.ui.WertKacheln

/**
 * Detail view of a manually entered part / minifigure — as a whole screen, like for
 * the sets, because the content (image, quantity choice, purchase and market prices per
 * condition, price history, delete) is too long for an AlertDialog.
 */
@Composable
fun ManualItemDetailRoute(
    vm: KaeufeViewModel,
    teile: PartsViewModel,
    figuren: MinifigsViewModel,
    type: Postenart,
    id: String,
    colorId: Int = OHNE_FARBE,
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit,
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
    /** Does the list behind it offer „Rückgängig“? Then deleting is only marked pending. */
    rueckgaengig: Boolean = false,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    // Observe only the entry's list: it loads when observed, the other one would stay unused.
    val teileZustand = if (type == Postenart.FIG) PartsUiState() else teile.teileState.collectAsStateWithLifecycle().value
    val minifigsState = if (type == Postenart.FIG) figuren.minifigsState.collectAsStateWithLifecycle().value else MinifigsUiState()
    val manDetailState by remember(type, id, colorId) { vm.purchasesOf(type, id, colorId) }.collectAsStateWithLifecycle()
    val lagerZustand by vm.storageState.collectAsStateWithLifecycle()
    ManualItemDetailScreen(
        zustand = EinzelstueckZustand(state, teileZustand, minifigsState, manDetailState, lagerZustand, rueckgaengig),
        kaeufe = vm, teile = teile, figuren = figuren, type = type, id = id, colorId = colorId,
        fallbackTitle = fallbackTitle, imageLoader = imageLoader, onBack = onBack,
        onNavigateToAcqMgmt = onNavigateToAcqMgmt, onFarbeGeaendert = onFarbeGeaendert,
    )
}

/** What a manual entry's detail view shows. */
internal data class EinzelstueckZustand(
    val state: AppUiState,
    val teile: PartsUiState,
    val figuren: MinifigsUiState,
    val manDetailState: ManualItemDetailUiState,
    val lagerZustand: LagerUiState,
    /** Does the list behind it offer „Rückgängig“? Then deleting is only marked pending. */
    val rueckgaengig: Boolean = false,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManualItemDetailScreen(
    zustand: EinzelstueckZustand,
    kaeufe: KaeufeAktionen,
    /** The entry's row and changing, deleting, recoloring. */
    teile: TeileAktionen,
    figuren: FigurenAktionen,
    type: Postenart,
    id: String,            // partNumber / figNumber
    colorId: Int = OHNE_FARBE,
    /** From the navigation — it stands in the bar until the valuation is loaded. */
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit,
    /**
     * The color was changed — the screen must be reopened with the new color:
     * it is part of the identity (route
     * manual_detail/{type}/{id}/{colorId}/{title}) and of the search below (`it.colorId ==
     * colorId`); otherwise it would stand empty even though the change succeeded. Default
     * empty, because a figure has no color.
     */
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
) {
    val rueckgaengig = zustand.rueckgaengig
    val state = zustand.state
    val teileZustand = zustand.teile
    val minifigsState = zustand.figuren
    val manDetailState = zustand.manDetailState
    val lagerZustand = zustand.lagerZustand

    val isFig = type == Postenart.FIG
    val currency = state.currency

    // Name and image come from the same list as in the tab (/parts/manual or
    // /minifigs/manual); it, the color choice and the purchases are loaded by the ViewModels when
    // observed, also after a deep link or a process restart.

    val fig  = if (isFig) minifigsState.manualFigs?.find { it.figNumber == id } else null
    val part = if (!isFig) teileZustand.manualParts?.find {
        it.partNumber == id && it.colorId == colorId
    } else null

    val title = fig?.figName ?: part?.partName ?: fallbackTitle.ifBlank { id }
    val quantity = fig?.quantity ?: part?.quantity ?: 1
    val imageUrl = resolveFullUrlViaProxy(
        state.serverUrl, fig?.imageLocal ?: part?.imageLocal, fig?.imageUrl ?: part?.imageUrl)

    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val accent = LocalAkzentflaechen.current
    Scaffold(
        topBar = {
            // The same header as every detail (DetailTopAppBar).
            DetailTopAppBar(
                titel = title,
                onZurueck = onBack,
                farben = TopAppBarDefaults.topAppBarColors(
                    containerColor = accent.detailLeiste,
                    titleContentColor = accent.onDetailBar,
                    navigationIconContentColor = accent.onDetailBar,
                    actionIconContentColor = accent.onDetailBar,
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
            contentPadding = PaddingValues(bottom = Abstaende.veryLarge),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            // ── Header: image and key figures, the same as for a part from a set ──
            item {
                val labelNumber = stringResource(
                    if (isFig) R.string.detail_fig_number else R.string.detail_part_number)
                val labelColor  = stringResource(R.string.detail_color)
                val farbe = farbTranslator()
                val chips = buildList {
                    add(labelNumber to id)
                    part?.colorName?.let { add(labelColor to farbe(it)) }
                    fig?.blFigNumber?.let { add("BrickLink" to it) }
                }
                PartDetailHeader(imageUrl, imageLoader, title, chips, onZoom = { showImageZoom = true },
                    Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel))
            }

            // ── Value tiles like in the set detail, in every theme ───────────────
            item {
                // The same words as in the set detail: one scaffold, one text for „kein Preis“.
                WertKacheln(
                    markt = (fig?.avgPrice ?: part?.avgPrice)?.let { fmtMoney(it, currency) }
                        ?: stringResource(R.string.detail_price_none_yet),
                    kauf = (fig?.purchasePrice ?: part?.purchasePrice)?.let { fmtMoney(it, currency) }
                        ?: stringResource(R.string.detail_purchase_none),
                    pnl = fig?.pnlProzent ?: part?.pnlProzent,
                    modifier = Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
                )
            }

            // ── Details: quantity and purchase prices ──────────────────────────────────
            item {
                SectionCard(title = stringResource(R.string.detail_section_item)) {
                    // Quantity follows the sum of the entries, as soon as there are
                    // any — after deleting an entry the counter is correct this
                    // way without keeping its own count.
                    val acqTotal = if (manDetailState.acquisitions.isNotEmpty())
                        manDetailState.acquisitions.sumOf { it.quantity } else quantity
                    var qty by remember(acqTotal) { mutableIntStateOf(acqTotal) }

                    QuantitiesRow(
                        menge = qty,
                        onFewer = {
                            if (qty > 1) {
                                qty--
                                // owner: owner of the CARD. In the household, the
                                // manual section shows the entries of all
                                // accounts; without this value the server writes
                                // into the caller's row.
                                if (isFig) figuren.updateMinifig(id, qty, fig?.unitPrice?.asDouble(), fig?.blFigNumber, owner = fig?.userId)
                                else teile.updatePart(id, colorId, qty, part?.unitPrice?.asDouble(), part?.condition, owner = part?.userId)
                            }
                        },
                        onMore = {
                            qty++
                            if (isFig) figuren.updateMinifig(id, qty, fig?.unitPrice?.asDouble(), fig?.blFigNumber, owner = fig?.userId)
                            else teile.updatePart(id, colorId, qty, part?.unitPrice?.asDouble(), part?.condition, owner = part?.userId)
                        },
                    )

                    // ── Color (parts only) — editable ──
                    //
                    // For the case that the color was loaded wrong. The field always stands there,
                    // even without a color name — this particular part is exactly the one that needs correcting.
                    if (!isFig) {
                        HorizontalDivider(Modifier.padding(vertical = Abstaende.tiny),
                            color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.hairline),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.detail_color),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            FarbWahlFeld(
                                farben = teileZustand.partsColors,
                                aktuell = colorId,
                                aktuellerName = part?.colorName,
                                currentHex = part?.colorHex,
                                onWahl = { c ->
                                    teile.setzeTeilFarbe(id, colorId, c.id, c.name, c.hex,
                                        owner = part?.userId, onFertig = onFarbeGeaendert)
                                },
                                modifier = Modifier.padding(start = Abstaende.gross)
                                    .widthIn(max = 180.dp),
                            )
                        }
                    }

                    HorizontalDivider(Modifier.padding(vertical = Abstaende.tiny),
                        color = MaterialTheme.colorScheme.outlineVariant)

                    // ── Storage location ──
                    //
                    // The same control and the same debounced path as in the set detail and the
                    // dialog for parts from sets; only the address depends on the type, because a figure
                    // has no color.
                    Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.hairline),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.detail_storage),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        LocationField(
                            wert = (if (isFig) fig?.storage else part?.storage) ?: "",
                            // The SUPPLY, not the occupied locations: even an
                            // empty shelf should be offered as a choice.
                            stock = lagerZustand.eigene.map { it.name },
                            onValue = { kaeufe.setManualLocation(type, id, colorId, it) },
                            modifier = Modifier.padding(start = Abstaende.gross)
                                .weight(1f).widthIn(max = 320.dp),
                        )
                    }

                    HorizontalDivider(Modifier.padding(vertical = Abstaende.tiny),
                        color = MaterialTheme.colorScheme.outlineVariant)

                    // The same summary as in the set detail — one row per
                    // purchase price, editing leads to the purchase-price screen.
                    AcquisitionSummarySection(
                        acquisitions = manDetailState.acquisitions,
                        currency = currency,
                        onEditPrices = { onNavigateToAcqMgmt(type, id, colorId, title) }
                    )
                }
            }

            // ── Market price per condition and history ──
            //
            // The loading state belongs in the condition: otherwise the section would only appear with
            // the answer, and until then "still loading" could not be told apart from
            // "no market prices" — like priceFetch in SetDetailSections.kt.
            val history = manDetailState.priceHistory
            val byCond  = history?.byCondition
            val chart   = history?.chart
            val laedt   = manDetailState.historyFetch.laedt
            if (byCond?.present()?.isNotEmpty() == true || chart?.values?.isNotEmpty() == true || laedt) {
                item {
                    SectionCard(title = stringResource(R.string.detail_section_market)) {
                        if (laedt && history == null) {
                            PriceLoadsRow()
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
            DeleteQuestion(
                isFig = isFig,
                title = title,
                onSchliessen = { showDeleteConfirm = false },
                deleteOn = {
                    showDeleteConfirm = false
                    // Here too the card's owner — otherwise the
                    // server deletes the caller's row instead of the shown one.
                    when {
                        isFig && rueckgaengig -> figuren.minifigDeleteReserve(id, fig?.userId, title)
                        isFig -> figuren.deleteMinifig(id, fig?.userId)
                        rueckgaengig -> teile.partDeleteReserve(id, colorId, part?.userId, title)
                        else -> teile.deletePart(id, colorId, part?.userId)
                    }
                    // The entry is gone — this screen would otherwise show a
                    // dead card with a quantity choice and purchase prices.
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

/** Quantity with minus and plus; what a change writes is decided by the caller. */
@Composable
private fun QuantitiesRow(menge: Int, onFewer: () -> Unit, onMore: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Abstaende.tiny),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(stringResource(R.string.common_quantity),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
            MitTooltip(stringResource(R.string.cd_qty_decrease)) {
                QuantitiesButton(onClick = onFewer) { Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(withFont(14.dp))) }
            }
            Text("$menge", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(min = 24.dp), textAlign = TextAlign.Center)
            MitTooltip(stringResource(R.string.cd_qty_increase)) {
                QuantitiesButton(onClick = onMore) { Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(withFont(14.dp))) }
            }
        }
    }
}

/** Confirmation prompt before deleting the part or the figure. */
@Composable
private fun DeleteQuestion(isFig: Boolean, title: String, onSchliessen: () -> Unit, deleteOn: () -> Unit) {
    // The shared confirmation prompt as for the set: the title as the heading and window name, scrollable text.
    Prompt(
        titel = stringResource(if (isFig) R.string.minifigs_delete_title else R.string.parts_delete_title),
        text = stringResource(if (isFig) R.string.minifigs_delete_text else R.string.parts_delete_text, title),
        bestaetigen = stringResource(R.string.common_delete),
        onBestaetigen = deleteOn,
        onAbbrechen = onSchliessen,
        symbol = Icons.Default.Delete,
    )
}
