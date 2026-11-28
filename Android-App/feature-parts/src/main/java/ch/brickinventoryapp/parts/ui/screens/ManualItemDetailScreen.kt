package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.parts.ui.MinifigsUiState
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.parts.ui.viewmodel.FiguresActions
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsActions
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.AcquisitionSummarySection
import ch.brickinventoryapp.shared.ui.LocationField
import ch.brickinventoryapp.shared.ui.MarketPriceByCondition
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.shared.ui.PriceLoadsRow
import ch.brickinventoryapp.shared.ui.SectionCard
import ch.brickinventoryapp.shared.ui.ValueTiles
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesActions
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.QuantityStepper
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.components.colorTranslator
import ch.brickinventoryapp.ui.theme.LocalAccentSurfaces
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.uistate.loading
import coil3.ImageLoader

/**
 * Detail view of a manually entered part / minifigure — as a whole screen, like for
 * the sets, because the content (image, quantity choice, purchase and market prices per
 * condition, price history, delete) is too long for an AlertDialog.
 */
@Composable
fun ManualItemDetailRoute(
    vm: PurchasesViewModel,
    parts: PartsViewModel,
    figures: MinifigsViewModel,
    item: PartsTarget.ManualItemDetail,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: ItemKind, id: String, colorId: Int, title: String) -> Unit,
    onColorChanged: (newColor: Int) -> Unit = {},
    /** Does the list behind it offer „Rückgängig“? Then deleting is only marked pending. */
    undo: Boolean = false,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    // Observe only the entry's list: it loads when observed, the other one would stay unused.
    val partsUiState = if (item.kind == ItemKind.FIG) PartsUiState() else parts.partsState.collectAsStateWithLifecycle().value
    val minifigsState = if (item.kind == ItemKind.FIG) figures.minifigsState.collectAsStateWithLifecycle().value else MinifigsUiState()
    val manDetailState by remember(item.kind, item.id, item.colorId) {
        vm.purchasesOf(item.kind, item.id, item.colorId)
    }.collectAsStateWithLifecycle()
    val storageUiState by vm.storageState.collectAsStateWithLifecycle()
    ManualItemDetailScreen(
        condition = SingleItemCondition(state, partsUiState, minifigsState, manDetailState, storageUiState, undo),
        actions = ManualItemActions(vm, parts, figures), item = item,
        imageLoader = imageLoader, onBack = onBack,
        onNavigateToAcqMgmt = onNavigateToAcqMgmt, onColorChanged = onColorChanged,
    )
}

/** What a manual entry's detail view shows. */
internal data class SingleItemCondition(
    val state: AppUiState,
    val parts: PartsUiState,
    val figures: MinifigsUiState,
    val manDetailState: ManualItemDetailUiState,
    val storageUiState: StorageUiState,
    /** Does the list behind it offer „Rückgängig“? Then deleting is only marked pending. */
    val undo: Boolean = false,
)

/** The purchases, and the entry's row with changing, deleting, recoloring. */
internal class ManualItemActions(val purchases: PurchasesActions, val parts: PartsActions, val figures: FiguresActions)

/** The entry as the tab lists it: a figure or a part of this color, null until loaded. */
private class ManualEntry(val item: PartsTarget.ManualItemDetail, val fig: ManualMinifigView?, val part: ManualPartView?) {
    val isFig get() = item.kind == ItemKind.FIG
    val title get() = fig?.figName ?: part?.partName ?: item.title.ifBlank { item.id }

    /**
     * owner: owner of the CARD. In the household, the manual section shows the entries of all
     * accounts; without this value the server writes into the caller's row.
     */
    fun setQuantity(actions: ManualItemActions, qty: Int) {
        if (isFig) actions.figures.updateMinifig(item.id, qty, fig?.unitPrice?.asDouble(), fig?.blFigNumber, owner = fig?.userId)
        else actions.parts.updatePart(item.id, item.colorId, qty, part?.unitPrice?.asDouble(), part?.condition, owner = part?.userId)
    }

    /** Here too the card's owner — otherwise the server deletes the caller's row instead of the shown one. */
    fun delete(actions: ManualItemActions, undo: Boolean) {
        when {
            isFig && undo -> actions.figures.minifigDeleteReserve(item.id, fig?.userId, title)
            isFig -> actions.figures.deleteMinifig(item.id, fig?.userId)
            undo -> actions.parts.partDeleteReserve(item.id, item.colorId, part?.userId, title)
            else -> actions.parts.deletePart(item.id, item.colorId, part?.userId)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManualItemDetailScreen(
    condition: SingleItemCondition,
    actions: ManualItemActions,
    item: PartsTarget.ManualItemDetail,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: ItemKind, id: String, colorId: Int, title: String) -> Unit,
    /**
     * The color was changed — the screen must be reopened with the new color:
     * it is part of the identity (route
     * manual_detail/{type}/{id}/{colorId}/{title}) and of the search below (`it.colorId ==
     * colorId`); otherwise it would stand empty even though the change succeeded. Default
     * empty, because a figure has no color.
     */
    onColorChanged: (newColor: Int) -> Unit = {},
) {
    val state = condition.state
    val currency = state.currency
    // Name and image come from the same list as in the tab (/parts/manual or
    // /minifigs/manual); it, the color choice and the purchases are loaded by the ViewModels when
    // observed, also after a deep link or a process restart.
    val isFig = item.kind == ItemKind.FIG
    val entry = ManualEntry(item,
        fig = if (isFig) condition.figures.manualFigs?.find { it.figNumber == item.id } else null,
        part = if (!isFig) condition.parts.manualParts?.find { it.partNumber == item.id && it.colorId == item.colorId } else null)
    val fig = entry.fig
    val part = entry.part
    val title = entry.title
    val imageUrl = resolveFullUrlViaProxy(
        state.serverUrl, fig?.imageLocal ?: part?.imageLocal, fig?.imageUrl ?: part?.imageUrl)

    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    // The entry is gone afterwards — this screen would otherwise show a dead card.
    val delete = { entry.delete(actions, condition.undo); onBack() }
    Scaffold(
        // With „Rückgängig“ in the list behind it that is the safeguard; only without it, it asks.
        topBar = { ManualItemTopBar(title, onBack) { if (condition.undo) delete() else showDeleteConfirm = true } },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = Spacing.veryLarge),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            // ── Header: image and key figures, the same as for a part from a set ──
            item { ManualItemHeader(entry, imageUrl, imageLoader) { showImageZoom = true } }

            // ── Value tiles like in the set detail, in every theme ───────────────
            item { ManualValueTiles(entry, currency) }

            // ── Details: quantity and purchase prices ──────────────────────────────────
            item {
                ManualItemDetails(entry, condition, actions, onColorChanged) {
                    onNavigateToAcqMgmt(item.kind, item.id, item.colorId, title)
                }
            }

            manualMarketSection(condition.manDetailState, currency)
        }

        if (showDeleteConfirm) {
            DeleteQuestion(
                isFig = isFig,
                title = title,
                onClose = { showDeleteConfirm = false },
                deleteOn = { showDeleteConfirm = false; delete() },
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

/** Image and key figures, the same as for a part from a set. */
@Composable
private fun ManualItemHeader(entry: ManualEntry, imageUrl: String?, imageLoader: ImageLoader, onZoom: () -> Unit) {
    val labelNumber = stringResource(
        if (entry.isFig) R.string.detail_fig_number else R.string.detail_part_number)
    val labelColor  = stringResource(R.string.detail_color)
    val color = colorTranslator()
    val chips = buildList {
        add(labelNumber to entry.item.id)
        entry.part?.colorName?.let { add(labelColor to color(it)) }
        entry.fig?.blFigNumber?.let { add("BrickLink" to it) }
    }
    PartDetailHeader(imageUrl, imageLoader, entry.title, chips, onZoom = onZoom,
        Modifier.padding(horizontal = Spacing.large, vertical = Spacing.medium))
}

/** The same words as in the set detail: one scaffold, one text for „kein Preis“. */
@Composable
private fun ManualValueTiles(entry: ManualEntry, currency: CurrencyCode) {
    val fig = entry.fig
    val part = entry.part
    ValueTiles(
        market = (fig?.avgPrice ?: part?.avgPrice)?.let { fmtMoney(it, currency) }
            ?: stringResource(R.string.detail_price_none_yet),
        purchase = (fig?.purchasePrice ?: part?.purchasePrice)?.let { fmtMoney(it, currency) }
            ?: stringResource(R.string.detail_purchase_none),
        pnl = fig?.pnlPercent ?: part?.pnlPercent,
        modifier = Modifier.padding(horizontal = Spacing.large).padding(bottom = Spacing.medium),
    )
}

/** The same header as every detail (DetailTopAppBar), with the delete button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ManualItemTopBar(title: String, onBack: () -> Unit, onDelete: () -> Unit) {
    val accent = LocalAccentSurfaces.current
    DetailTopAppBar(
        title = title,
        onBack = onBack,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = accent.detailBar,
            titleContentColor = accent.onDetailBar,
            navigationIconContentColor = accent.onDetailBar,
            actionIconContentColor = accent.onDetailBar,
        ),
        actions = {
            WithTooltip(stringResource(R.string.common_delete)) {
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                }
            }
        },
    )
}

/** Quantity, color (parts only), storage location and the purchase prices. */
@Composable
private fun ManualItemDetails(
    entry: ManualEntry,
    condition: SingleItemCondition,
    actions: ManualItemActions,
    onColorChanged: (newColor: Int) -> Unit,
    onEditPrices: () -> Unit,
) {
    val item = entry.item
    val acquisitions = condition.manDetailState.acquisitions
    SectionCard(title = stringResource(R.string.detail_section_item)) {
        // Quantity follows the sum of the entries, as soon as there are
        // any — after deleting an entry the counter is correct this
        // way without keeping its own count.
        val acqTotal = if (acquisitions.isNotEmpty()) acquisitions.sumOf { it.quantity }
            else entry.fig?.quantity ?: entry.part?.quantity ?: 1
        var qty by remember(acqTotal) { mutableIntStateOf(acqTotal) }

        QuantityStepper(
            quantity = qty,
            onFewer = { if (qty > 1) { qty--; entry.setQuantity(actions, qty) } },
            onMore = { qty++; entry.setQuantity(actions, qty) },
        )

        // ── Color (parts only) — editable ──
        //
        // For the case that the color was loaded wrong. The field always stands there,
        // even without a color name — this particular part is exactly the one that needs correcting.
        if (!entry.isFig) ManualColorRow(entry, condition.parts.partsColors, actions.parts, onColorChanged)

        HorizontalDivider(Modifier.padding(vertical = Spacing.tiny),
            color = MaterialTheme.colorScheme.outlineVariant)

        // ── Storage location ──
        //
        // The same control and the same debounced path as in the set detail and the
        // dialog for parts from sets; only the address depends on the type, because a figure
        // has no color.
        Row(Modifier.fillMaxWidth().padding(vertical = Spacing.hairline),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.detail_storage),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            LocationField(
                value = (if (entry.isFig) entry.fig?.storage else entry.part?.storage) ?: "",
                // The SUPPLY, not the occupied locations: even an
                // empty shelf should be offered as a choice.
                stock = condition.storageUiState.own.map { it.name },
                onValue = { actions.purchases.setManualLocation(item.kind, item.id, item.colorId, it) },
                modifier = Modifier.padding(start = Spacing.large)
                    .weight(1f).widthIn(max = 320.dp),
            )
        }

        HorizontalDivider(Modifier.padding(vertical = Spacing.tiny),
            color = MaterialTheme.colorScheme.outlineVariant)

        // The same summary as in the set detail — one row per
        // purchase price, editing leads to the purchase-price screen.
        AcquisitionSummarySection(
            acquisitions = acquisitions,
            currency = condition.state.currency,
            onEditPrices = onEditPrices,
        )
    }
}

/** The part's color, changeable; after a change the screen reopens with the new color. */
@Composable
private fun ManualColorRow(
    entry: ManualEntry,
    colors: List<ColorView>,
    parts: PartsActions,
    onColorChanged: (newColor: Int) -> Unit,
) {
    val item = entry.item
    HorizontalDivider(Modifier.padding(vertical = Spacing.tiny),
        color = MaterialTheme.colorScheme.outlineVariant)
    Row(Modifier.fillMaxWidth().padding(vertical = Spacing.hairline),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.detail_color),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        ColorChoiceField(
            colors = colors,
            current = item.colorId,
            currentName = entry.part?.colorName,
            currentHex = entry.part?.colorHex,
            onChoice = { c ->
                parts.setPartColor(item.id, item.colorId, c.id, c.name, c.hex,
                    owner = entry.part?.userId, onDone = onColorChanged)
            },
            modifier = Modifier.padding(start = Spacing.large)
                .widthIn(max = 180.dp),
        )
    }
}

/**
 * Market price per condition and history. The loading state belongs in the condition: otherwise
 * the section would only appear with the answer, and until then "still loading" could not be told
 * apart from "no market prices" — like priceFetch in SetDetailSections.kt.
 */
private fun LazyListScope.manualMarketSection(manDetailState: ManualItemDetailUiState, currency: CurrencyCode) {
    val history = manDetailState.priceHistory
    val byCond  = history?.byCondition
    val chart   = history?.chart
    val loading   = manDetailState.historyFetch.loading
    if (byCond?.present()?.isNotEmpty() != true && chart?.values?.isNotEmpty() != true && !loading) return
    item {
        SectionCard(title = stringResource(R.string.detail_section_market)) {
            if (loading && history == null) {
                PriceLoadsRow()
            }
            byCond?.takeIf { it.present().isNotEmpty() }?.let {
                MarketPriceByCondition(it, currency)
            }
            chart?.takeIf { it.values.isNotEmpty() }?.let {
                Spacer(Modifier.height(Spacing.small))
                PriceChart(it, currency)
            }
        }
    }
}

/** Confirmation prompt before deleting the part or the figure. */
@Composable
private fun DeleteQuestion(isFig: Boolean, title: String, onClose: () -> Unit, deleteOn: () -> Unit) {
    // The shared confirmation prompt as for the set: the title as the heading and window name, scrollable text.
    Prompt(
        title = stringResource(if (isFig) R.string.minifigs_delete_title else R.string.parts_delete_title),
        text = stringResource(if (isFig) R.string.minifigs_delete_text else R.string.parts_delete_text, title),
        confirm = stringResource(R.string.common_delete),
        onConfirm = deleteOn,
        onCancel = onClose,
        symbol = Icons.Default.Delete,
    )
}
