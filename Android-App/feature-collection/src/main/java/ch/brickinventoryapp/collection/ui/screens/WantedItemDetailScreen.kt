package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListActions
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.util.resolveFullUrl
import ch.brickinventoryapp.network.util.externalAddress
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.shared.ui.PriceLoadsRow
import ch.brickinventoryapp.ui.components.CatalogDetailRow
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.PartialLoadFailed
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.ui.util.openExtern
import kotlinx.coroutines.launch

/**
 * A watchlist item's detail — the same rows in the same order as the
 * set detail, minus what a watchlist item doesn't have (purchase price, quantity, storage location, manuals;
 * "added" here means "on the list since"). Market price and history are drawn by the same
 * PriceChart().
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WantedItemDetailScreen(
    view: WantedListState,
    actions: WantedListActions,
    setNumber: String,
    condition: Condition,
    imageLoader: coil3.ImageLoader,
    onBack: () -> Unit,
    /** From one item's alert to all of them (Settings → Preisalarme). */
    onOpenPriceAlerts: (() -> Unit)? = null,
) {
    val appState = view.appState
    val glance = view.glance
    // The STOCK of storage locations for the take-over dialog.
    val storageUiState = view.storageUiState
    val list    = view.list
    val detail   = view.detail
    val ctx = LocalContext.current
    // stringResource instead of ctx.getString in the callback: a context grabbed from
    // LocalContext delivers stale values after a config change (Lint
    // LocalContextGetResourceValueCall).
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar in its own scaffold instead of Toast: stays readable until TalkBack is done.
    val messages = remember { SnackbarHostState() }
    val area = rememberCoroutineScope()
    // The same dialog as in the list, not a second one: quantity, purchase price
    // and condition must be the same mask here.
    var openTakeover by rememberSaveable { mutableStateOf(false) }
    // Zoom as in the set and catalog detail and in the web app. rememberSaveable: whoever
    // rotates the phone while zoomed should stay in it.
    var openZoom by rememberSaveable { mutableStateOf(false) }

    val wantedItem = list.wantedItem.firstOrNull {
        it.setNumber == setNumber && it.condition == condition
    }

    // The watchlist item is gone (deleted or taken over) — then this
    // screen should be gone too, instead of showing a corpse.
    LaunchedEffect(wantedItem == null, list.fetch.loading) {
        if (wantedItem == null && !list.fetch.loading && list.wantedItem.isNotEmpty()) onBack()
    }

    val noPrice = stringResource(R.string.detail_price_none_yet)
    fun price(v: Money?) = if (v == null) noPrice else fmtMoney(v, appState.currency)

    Scaffold(
        snackbarHost = { SnackbarHost(messages) },
        topBar = {
            // The same header as the set, catalog and parts detail (DetailTopAppBar).
            DetailTopAppBar(title = wantedItem?.name ?: setNumber, onBack = onBack,
                // Without a confirmation as in the web app: a watchlist item isn't owned and is quickly
                // re-added. `let`, because the watchlist item up here is still nullable.
                actions = {
                    wantedItem?.let { w ->
                        WithTooltip(stringResource(R.string.common_delete)) {
                            IconButton(onClick = {
                                actions.deleteWantedItem(w.setNumber, w.condition, w.userId)
                            }) {
                                Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (wantedItem == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        // Determine the address ONCE: the preview image and zoom would otherwise possibly
        // show two different images — and `resolveFullUrl` already
        // delivers the full resolution anyway (no thumb).
        val imageUrl = resolveFullUrl(appState.serverUrl,
            detail.catalog?.imageLocal ?: wantedItem.imageLocal, wantedItem.imageUrl)

        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(Spacing.large),
            verticalArrangement = Arrangement.spacedBy(Spacing.medium),
        ) {
            item {
                ProductImage(
                    model = imageUrl,
                    contentDescription = wantedItem.name,
                    imageLoader = imageLoader,
                    // Tapping opens the zoom — the same behavior as in the
                    // set and catalog detail.
                    modifier = Modifier.fillMaxWidth().height(Spacing.huge * 5)
                        .clip(MaterialTheme.shapes.medium)
                        .clickable(enabled = imageUrl != null, onClickLabel = stringResource(R.string.cd_image_enlarge), role = Role.Button) { openZoom = true },
                    fallbackSize = Spacing.huge * 2,
                    imageBackground = true,
                    innerGap = Spacing.medium,
                )
            }

            // The cards limit the width (as in the set detail), not every element within them.
            item {
                AppCard(Modifier.centeredUntil(ReadingWidth.form)) {
                    // With spacing between the rows as in the catalog detail: stacked tightly,
                    // the card read as one block.
                    Column(Modifier.padding(Spacing.medium), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                        // Only rows with a value: four dashes in a row only said
                        // that the catalog doesn't know the set.
                        CatalogDetailRow(stringResource(R.string.detail_set_number), wantedItem.setNumber)
                        wantedItem.year?.let { CatalogDetailRow(stringResource(R.string.detail_year), it.toString()) }
                        detail.catalog?.themeName?.let { CatalogDetailRow(stringResource(R.string.detail_theme), it) }
                        (detail.catalog?.numParts ?: wantedItem.numParts)?.let {
                            CatalogDetailRow(stringResource(R.string.detail_pieces), fmtInt(it))
                        }
                        detail.catalog?.minifigs?.let {
                            CatalogDetailRow(stringResource(R.string.detail_minifigs), fmtInt(it))
                        }
                        CatalogDetailRow(stringResource(R.string.common_condition),
                            stringResource(if (wantedItem.condition == Condition.USED) R.string.condition_used
                                           else R.string.condition_new))
                        CatalogDetailRow(stringResource(R.string.wanted_since),
                            fmtTag(wantedItem.createdAt) ?: "—")

                        // ── The owner, changeable ──
                        //
                        // The same picker as in the entry masks; on a single account
                        // it hides itself.
                        if (glance.householdMembers.size > 1) {
                            Spacer(Modifier.height(Spacing.small))
                            OwnerPicker(
                                members = glance.householdMembers,
                                selected = wantedItem.userId,
                                onSelect = { actions.moveWantedItem(
                                    wantedItem.setNumber, wantedItem.condition, wantedItem.userId, it) },
                            )
                        }
                    }
                }
            }

            // ── The price alert, editable ──
            //
            // The same section as in the set detail: the same entry in price_alerts under the same
            // key, and /sets/:sn/alert requires no ownership.
            setDetailAlarmSection(wantedItem.setNumber, detail.priceAlarms, appState.currency, actions::setPriceAlert,
                outerGap = false, onAllAlerts = onOpenPriceAlerts)

            item {
                AppCard(Modifier.centeredUntil(ReadingWidth.form)) {
                    Column(Modifier.padding(Spacing.medium)) {
                        SectionTitle(stringResource(R.string.detail_section_market))
                        Spacer(Modifier.height(Spacing.small))
                        // From the PRICE response, not from the history: that
                        // fetches fresh, the history only reads the cache.
                        CatalogDetailRow(stringResource(R.string.condition_new),
                            price(detail.prices?.current?.new?.avgPrice))
                        CatalogDetailRow(stringResource(R.string.condition_used),
                            price(detail.prices?.current?.used?.avgPrice))

                        val chart = detail.history?.chart
                        if (chart != null && chart.values.isNotEmpty()) {
                            Spacer(Modifier.height(Spacing.small))
                            PriceChart(chart, appState.currency)
                        } else if (detail.fetch.loading) {
                            Spacer(Modifier.height(Spacing.small))
                            PriceLoadsRow()
                        }
                        PartialLoadFailed(detail.fetch, { actions.loadWantedItemDetail(wantedItem.setNumber) })
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    // BrickLink and price comparison side by side, with spacing below them the
                    // take-over: on top the paths outward, below the controls that change
                    // something. If one address drops out, the other takes the whole row.
                    val addresses = listOfNotNull(
                        detail.catalog?.bricklink?.url?.takeIf { it.isNotBlank() }
                            ?.let { R.string.catalog_buy_bricklink to it },
                        // The catalog delivers the same address, only with the name
                        // in it ("LEGO 75192 Millennium Falcon" instead of just the
                        // number). If it doesn't come back — 404 for a set that
                        // rb_sets doesn't know — the watchlist item's own is ready.
                        (detail.catalog?.priceComparisonUrl ?: wantedItem.priceComparisonUrl)
                            ?.takeIf { it.isNotBlank() }
                            ?.let { R.string.detail_compare to it },
                    )
                    val width = Modifier.fillMaxWidth()
                    if (addresses.isNotEmpty()) {
                        Row(
                            width,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                        ) {
                            for ((label, url) in addresses) {
                                OutlinedButton(
                                    onClick = {
                                        if (!openExtern(ctx, externalAddress(url))) {
                                            area.launch { messages.showSnackbar(noAppText) }
                                        }
                                    },
                                    modifier = Modifier.weight(1f),
                                    contentPadding = PaddingValues(
                                        horizontal = Spacing.small, vertical = Spacing.small),
                                    colors = secondaryButtonColors(),
                                    border = secondaryButtonRand(),
                                ) {
                                    // One step smaller, for the same reason as in the
                                    // catalog detail: two buttons share the
                                    // width that one alone used to have.
                                    Text(stringResource(label), maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                        Spacer(Modifier.height(Spacing.small))
                    }

                    Button(
                        onClick = { openTakeover = true },
                        modifier = width,
                    ) {
                        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
                        Spacer(Modifier.width(Spacing.tiny))
                        Text(stringResource(R.string.wanted_take))
                    }
                }
            }
        }
    }

    // Outside the scaffold, so the dialogs sit above everything — and with
    // `let`, because `wantedItem` is nullable again here: whoever deletes the
    // last entry elsewhere while the dialog is open shouldn't get a crash,
    // just nothing.
    if (openZoom) wantedItem?.let { w ->
        // The same address as the image above, recalculated here because `wantedItem`
        // is nullable again outside the scaffold body. Drawn by
        // ui/components/ZoomableImageDialog.kt as in the set and catalog detail.
        val zoomUrl = resolveFullUrl(appState.serverUrl,
            detail.catalog?.imageLocal ?: w.imageLocal, w.imageUrl)
        if (zoomUrl != null) {
            ZoomableImageDialog(
                imageUrl = zoomUrl,
                contentDescription = w.name,
                imageLoader = imageLoader,
                onDismiss = { openZoom = false },
            )
        }
    }

    if (openTakeover) wantedItem?.let { w ->
        AdoptionDialog(
            wantedItem = w,
            storageLocations = storageUiState.own.map { it.name },
            locationDefault = storageUiState.default?.name ?: "",
            onDismiss = { openTakeover = false },
            onAdopt = { count, priceRaw, stateChoice, location ->
                actions.adoptWantedItem(w.setNumber, w.condition, w.userId,
                                   count, priceRaw, stateChoice, location)
                openTakeover = false
            },
        )
    }
}
