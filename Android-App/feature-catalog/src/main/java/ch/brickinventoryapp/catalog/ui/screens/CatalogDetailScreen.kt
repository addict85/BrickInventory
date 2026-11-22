package ch.brickinventoryapp.catalog.ui.screens

import androidx.compose.foundation.ScrollState
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.catalog.ui.WantedRequest
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Condition
import androidx.compose.material.icons.filled.Bookmark
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Shapes
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BookmarkAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.data.util.BrickLinkUrls
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.ui.twoColumn
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrl
import coil3.ImageLoader
import kotlinx.coroutines.launch
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.LoadCircle
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.network.util.externalAddress
import ch.brickinventoryapp.ui.util.openExtern
import ch.brickinventoryapp.ui.components.CatalogDetailRow
import ch.brickinventoryapp.shared.ui.StorageLocationEntry
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.ConditionRow

/**
 * Catalog detail: image, metadata (year, theme, parts, minifigures) and
 * "Add to gallery" button with a quantity/price/condition dialog.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogDetailScreen(
    setNumber: String,
    /** An error stands with "Try again" instead of the spinner. */
    loaded: Load<CatalogDetailView>,
    imageLoader: ImageLoader,
    serverUrl: String,
    defaultCondition: Condition = Condition.NEW,
    /** Household members — the account picker hides itself without them. */
    householdMembers: List<MemberView> = emptyList(),
    /** Stock of storage locations for the entry dialog. */
    storageLocations: List<String> = emptyList(),
    /** The preselected storage location (star in settings). Empty means: no default. */
    locationDefault: String = "",
    onLoad: (String) -> Unit,
    onAddToGallery: (EntryRequest) -> Unit,
    /** Add to watchlist; the target account as in the entry dialog and the web app (cat-m-owner). */
    onWish: (WantedRequest) -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBack: () -> Unit,
    /** The watchlist item for this set, if it's already on the watchlist. */
    wanted: WantedItemView? = null,
    /** Open the watchlist item — set number and condition. */
    onOpenWantedItem: (String, Condition) -> Unit = { _, _ -> },
) {
    val detail = loaded.dataOrNull()
    LaunchedEffect(setNumber) { onLoad(setNumber) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var showWishDialog by rememberSaveable { mutableStateOf(false) }
    // Screen-filling zoom as in the set detail — here too, on user request.
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    val ctx = LocalContext.current
    // `stringResource` instead of `ctx.getString` in the callback: a context grabbed from
    // LocalContext.current can deliver stale values after a config change (language, dark mode,
    // rotation) (Lint: LocalContextGetResourceValueCall). In
    // the composition, Compose re-evaluates it on a change.
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar in its own scaffold instead of Toast: stays readable until TalkBack is done.
    val messages = remember { SnackbarHostState() }
    val area = rememberCoroutineScope()

    val roles = rememberScrollState()

    Scaffold(
        snackbarHost = { SnackbarHost(messages) },
        // The name sits in the bar as in the set detail (DetailTopAppBar), not only in the content.
        topBar = { DetailTopAppBar(title = detail?.name ?: setNumber, onBack = onBack) }
    ) { padding ->
        when {
            loaded is Load.Failure -> StateHint(Modifier.padding(padding)) {
                ErrorHint(loaded.message.sentence(), { onLoad(setNumber) }, loaded.kind)
            }
            detail == null -> LoadCircle(Modifier.padding(padding))
            else -> CatalogDetailContent(
                detail, serverUrl, imageLoader, wanted, roles, Modifier.padding(padding),
                onZoom = { showImageZoom = true },
                rememberOn = { if (wanted != null) onOpenWantedItem(wanted.setNumber, wanted.condition) else showWishDialog = true },
                captureOn = { showAddDialog = true },
                onOpenInGallery = onOpenInGallery,
                onBrickLink = { url ->
                    // Don't swallow silently: with no browser present, otherwise nothing would happen.
                    if (!openExtern(ctx, externalAddress(url))) {
                        area.launch { messages.showSnackbar(noAppText) }
                    }
                },
            )
        }
    }

    CatalogDetailDialogs(
        detail = detail, rememberItem = showWishDialog, take = showAddDialog, zoom = showImageZoom,
        defaultCondition = defaultCondition, householdMembers = householdMembers,
        storageLocations = storageLocations, locationDefault = locationDefault, serverUrl = serverUrl, imageLoader = imageLoader,
        onWish = onWish, onAddToGallery = onAddToGallery,
        onClose = { showWishDialog = false; showAddDialog = false; showImageZoom = false },
    )
}

/** Image and details; two columns from "expanded" on. */
@Composable
private fun CatalogDetailContent(
    detail: CatalogDetailView,
    serverUrl: String,
    imageLoader: ImageLoader,
    wanted: WantedItemView?,
    roles: ScrollState,
    modifier: Modifier,
    onZoom: () -> Unit,
    rememberOn: () -> Unit,
    captureOn: () -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBrickLink: (String) -> Unit,
) {
    val ctx = LocalContext.current
    BoxWithConstraints(modifier.fillMaxSize()) {
        // Via the server proxy — full resolution; the downloaded file takes
        // priority, the same server check as in the catalog list.
        val fullUrl = remember(detail.setNumber, serverUrl) {
            resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)
        }
        // Tapping opens the zoom as in the set detail. White image background, muted
        // in the dark — like the set detail, instead of a glaring surface.
        val image: @Composable (Modifier) -> Unit = { m ->
            ProductImage(
                model = fullUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                imageLoader = imageLoader,
                contentDescription = detail.name,
                modifier = m.clip(Shapes.card)
                    .clickable(enabled = fullUrl != null, onClickLabel = stringResource(R.string.cd_image_enlarge), role = Role.Button) { onZoom() },
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                fallbackSize = 64.dp,
                imageBackground = true,
                innerGap = Spacing.medium,
            )
        }
        val info: @Composable ColumnScope.() -> Unit = {
            CatalogDetails(
                detail = detail,
                wanted = wanted,
                rememberOn = rememberOn,
                captureOn = captureOn,
                onOpenInGallery = onOpenInGallery,
                onBrickLink = onBrickLink,
            )
        }
        // Two columns from "expanded" on, like the set detail: image left, details and
        // actions right. Single-column, the table and buttons ran across the whole
        // tablet width, "Year" stood an arm's length from "2022".
        if (twoColumn(maxWidth.value)) {
            Row(Modifier.fillMaxSize().padding(horizontal = Spacing.large),
                horizontalArrangement = Arrangement.spacedBy(Spacing.veryLarge)) {
                Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = Spacing.large),
                    contentAlignment = Alignment.TopCenter) {
                    image(Modifier.widthIn(max = IMAGE_AT_MOST).fillMaxWidth().aspectRatio(IMAGE_RATIO))
                }
                Column(
                    Modifier.weight(1f).fillMaxHeight().verticalScroll(roles).padding(vertical = Spacing.large),
                    verticalArrangement = Arrangement.spacedBy(Spacing.medium),
                ) { info() }
            }
        } else Column(
            Modifier.fillMaxSize().verticalScroll(roles).padding(Spacing.large),
            verticalArrangement = Arrangement.spacedBy(Spacing.medium),
        ) {
            image(Modifier.fillMaxWidth().height(220.dp))
            info()
        }
    }
}

/** Watchlist, add and zoom of the catalog detail; [onClose] closes whatever is open. */
@Composable
private fun CatalogDetailDialogs(
    detail: CatalogDetailView?,
    rememberItem: Boolean,
    take: Boolean,
    zoom: Boolean,
    defaultCondition: Condition,
    householdMembers: List<MemberView>,
    storageLocations: List<String>,
    locationDefault: String,
    serverUrl: String,
    imageLoader: ImageLoader,
    onWish: (WantedRequest) -> Unit,
    onAddToGallery: (EntryRequest) -> Unit,
    onClose: () -> Unit,
) {
    if (rememberItem && detail != null) {
        WantedItemDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            onDismiss = onClose,
            onWish = { condition, direction, threshold, account ->
                onWish(WantedRequest(detail.setNumber, condition, direction, threshold, account))
                onClose()
            },
        )
    }

    if (take && detail != null) {
        CatalogAddDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            storageLocations = storageLocations,
            locationDefault = locationDefault,
            onDismiss = onClose,
            onAdd = { wish ->
                onClose()
                onAddToGallery(wish.copy(setNumber = detail.setNumber))
            }
        )
    }

    if (zoom) {
        // The same address as the preview image above: resolveFullUrl() already
        // delivers the full resolution (no thumb) — a second call with
        // different values would only drift apart.
        val zoomUrl = resolveFullUrl(serverUrl, detail?.imageLocal, detail?.imageUrl)
        if (zoomUrl != null) {
            ZoomableImageDialog(
                imageUrl = zoomUrl,
                contentDescription = detail?.name,
                imageLoader = imageLoader,
                onDismiss = onClose
            )
        }
    }
}

/** Aspect ratio of set images; on the tablet the image has its own column this way. */
private const val IMAGE_RATIO = 4f / 3f

/** Larger than the source, a set image only gets blurry; next to it there's room for the details. */
private val IMAGE_AT_MOST = 480.dp

/** The set's details as a table, with ownership and the watchlist item, when they exist. */
@Composable
private fun CatalogTable(detail: CatalogDetailView, wanted: WantedItemView?) {
    Card(shape = Shapes.card, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
        Column(Modifier.padding(Spacing.edge), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            CatalogDetailRow(stringResource(R.string.catalog_detail_year),   detail.year?.toString() ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_theme),  detail.themeName ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_parts),  detail.numParts?.takeIf { it > 0 }?.let { fmtInt(it) } ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_minifigs), if (detail.minifigs > 0) detail.minifigs.toString() else "—")
            if (detail.owned) {
                CatalogDetailRow(stringResource(R.string.catalog_owned), "✓ ×${detail.ownedQuantity}")
            }
            // If the set is already on the watchlist, the table says so — with condition and alert.
            if (wanted != null) CatalogDetailRow(stringResource(R.string.catalog_on_wanted_list), wantedItemText(wanted))
        }
    }
}

/**
 * Number, details and actions; the name sits in the bar. The app's own actions
 * first (add, watchlist), the path outward as a text button with an arrow below:
 * it used to sit above them and looked like the main action.
 */
@Composable
private fun ColumnScope.CatalogDetails(
    detail: CatalogDetailView,
    wanted: WantedItemView?,
    rememberOn: () -> Unit,
    captureOn: () -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBrickLink: (String) -> Unit,
) {
    // Not tappable, hence not in the color of links and buttons.
    Text(detail.setNumber, color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)

    CatalogTable(detail, wanted)

    // Stacked at full width as in the watchlist-item detail: side by side,
    // "Add to collection" was already truncated at normal font size. Adding is the
    // more frequent action and sits on top, filled, watchlisting below, outlined.
    // At most control width: on the tablet the buttons otherwise ran across the whole column.
    val button = Modifier.widthIn(max = ReadingWidth.controls).fillMaxWidth()
    Button(onClick = captureOn, modifier = button) {
        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(if (detail.owned) R.string.catalog_add_again else R.string.catalog_add_to_gallery),
            textAlign = TextAlign.Center)
    }
    // Watchlisted: go to the watchlist item instead of watchlisting a second time.
    OutlinedButton(onClick = rememberOn, modifier = button, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
        Icon(if (wanted != null) Icons.Default.Bookmark else Icons.Default.BookmarkAdd, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(if (wanted != null) R.string.catalog_wanted_item_open else R.string.wanted_add_submit),
            textAlign = TextAlign.Center)
    }
    if (detail.owned) {
        OutlinedButton(onClick = { onOpenInGallery(detail.setNumber) }, modifier = button, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
            Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.catalog_open_in_gallery))
        }
    }

    // The buy URL comes ready-made from the server — for gear and books the parameters and
    // number would differ from sets; the fallback stays for older servers. For
    // collectible minifigures the server delivers a search URL and exact = false.
    val bl = detail.bricklink
    val blUrl = bl?.url ?: BrickLinkUrls.searchFor(detail.setNumber)
    val blLabel = if (bl != null && !bl.exact) R.string.catalog_search_bricklink else R.string.catalog_buy_bricklink
    // As wide as the buttons above: centered on its own it stood off their axis on the tablet.
    TextButton(onClick = { onBrickLink(blUrl) }, modifier = button) {
        Icon(Icons.Default.ShoppingCart, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(blLabel))
        Spacer(Modifier.width(Spacing.tiny))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(withFont(16.dp)))
    }
}

/** "New, alert below CHF 349.00" — condition and alert of a watchlist item in one line. */
@Composable
private fun wantedItemText(m: WantedItemView): String {
    val condition = stringResource(if (m.condition == Condition.USED) R.string.condition_used else R.string.condition_new)
    val alarm = m.alarm?.let { a ->
        stringResource(if (a.direction == AlarmDirection.OVER) R.string.wanted_alert_above else R.string.wanted_alert_below,
            fmtMoney(a.threshold, m.currency))
    }
    return listOfNotNull(condition, alarm).joinToString(", ")
}

/** Ask quantity/price/condition — like AddSetDialog, but without a set-number field. */
@Composable
private fun CatalogAddDialog(
    setName: String,
    defaultCondition: Condition,
    householdMembers: List<MemberView>,
    /** Stock of storage locations — empty means: there are none yet, then it's typed in. */
    storageLocations: List<String>,
    /** The preselected storage location (star in settings). Empty means: no default. */
    locationDefault: String = "",
    onDismiss: () -> Unit,
    /** Without a set number: the detail the dialog belongs to sets it. */
    onAdd: (EntryRequest) -> Unit
) {
    var quantity      by rememberSaveable { mutableStateOf("1") }
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition     by rememberSaveable { mutableStateOf(defaultCondition) }
    // Key is the default: it comes over the network and can arrive after
    // opening. An own input stays as is, because the default
    // doesn't change after that.
    var storageLocation      by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Pre-filled with one's own account, exactly as in the gallery dialog.
    val own = householdMembers.firstOrNull { it.isSelf }?.id
    var owner         by remember(householdMembers) { mutableStateOf(own) }

    // The shared frame (AddDialog): title as heading and window name, scrollable
    // and full-screen at large font sizes; both were missing before.
    AddDialog(
        title = stringResource(R.string.catalog_add_to_gallery),
        confirm = stringResource(R.string.catalog_add_confirm),
        onConfirm = { onAdd(EntryRequest(
            setNumber = "",
            quantity = quantity.toIntOrNull() ?: 1,
            purchasePrice = NumericInput.readMoney(purchasePrice),
            condition = condition,
            // Without a household, send nothing at all — the server then stays
            // on one's own account (same rule as in the gallery dialog).
            owner = if (householdMembers.size > 1) owner else null,
            storageLocation = storageLocation.trim().takeIf { it.isNotEmpty() },
        )) },
        onCancel = onDismiss,
        confirmEnabled = !entryInvalid(quantity, purchasePrice),
        changed = quantity != "1" || purchasePrice.isNotEmpty() || condition != defaultCondition ||
            storageLocation != locationDefault || owner != own,
    ) {
        Text(setName, fontWeight = FontWeight.SemiBold)
        // Hides itself with fewer than two members.
        OwnerPicker(householdMembers, owner, { owner = it })
        // Quantity and price as in the gallery's entry dialog: filtered and with the matching keyboard.
        OutlinedTextField(
            shape = Shapes.field,
            value = quantity,
            onValueChange = { quantity = NumericInput.quantity(it) },
            label = { Text(stringResource(R.string.common_quantity)) },
            isError = NumericInput.quantityInvalid(quantity),
            supportingText = { if (NumericInput.quantityInvalid(quantity)) Text(stringResource(R.string.record_quantity_invalid), Modifier.announce()) },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = NumericInput.integerKeyboard()
        )
        OutlinedTextField(
            shape = Shapes.field,
            value = purchasePrice,
            onValueChange = { purchasePrice = NumericInput.price(it) },
            label = { Text(stringResource(R.string.gallery_purchase_price)) },
            isError = NumericInput.priceInvalid(purchasePrice),
            supportingText = { if (NumericInput.priceInvalid(purchasePrice)) Text(stringResource(R.string.record_price_invalid), Modifier.announce()) },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = NumericInput.priceKeyboard()
        )
        ConditionRow(condition = condition, onUiState = { condition = it })
        StorageLocationEntry(storageLocation, storageLocations, { storageLocation = it })
    }
}

/**
 * Condition and price alert for a watchlist item. No quantity and no purchase price:
 * a watchlist item has neither, those are only asked when taking it over. The
 * alert is optional and sits under its own heading — whoever just wants to watchlist
 * it leaves the field empty.
 */
@Composable
private fun WantedItemDialog(
    setName: String,
    defaultCondition: Condition,
    /** Household accounts — without sub-accounts, the picker hides itself. */
    householdMembers: List<MemberView>,
    onDismiss: () -> Unit,
    onWish: (Condition, AlarmDirection, String, Int?) -> Unit,
) {
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    var direction by rememberSaveable { mutableStateOf(AlarmDirection.BELOW) }
    var threshold by rememberSaveable { mutableStateOf("") }
    // Pre-filled with one's own account, exactly as in the entry dialog next to it.
    var account    by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    // The same frame as "Watchlist set" in the watchlist and every entry.
    AddDialog(
        title = stringResource(R.string.wanted_add_submit),
        confirm = stringResource(R.string.wanted_add_submit),
        onConfirm = { onWish(condition, direction, threshold,
            // Without a household, send nothing at all — then the server stays
            // on one's own account (same rule as in the entry dialog).
            if (householdMembers.size > 1) account else null) },
        onCancel = onDismiss,
        changed = threshold.isNotEmpty() || condition != defaultCondition || direction != AlarmDirection.BELOW,
    ) {
                Text(setName, style = MaterialTheme.typography.bodyMedium)
                // Target account as when entering; hides itself with fewer than
                // two members.
                OwnerPicker(householdMembers, account, { account = it })
                ConditionRow(condition = condition, onUiState = { condition = it })
                HorizontalDivider()
                Text(stringResource(R.string.detail_alert),
                     style = MaterialTheme.typography.labelLarge)
                SegmentChoice(
                    options = listOf(AlarmDirection.BELOW to stringResource(R.string.detail_alert_chip_below),
                                      AlarmDirection.OVER to stringResource(R.string.detail_alert_chip_above)),
                    chosen = direction,
                    onChoice = { direction = it },
                )
                // A threshold is a price — the same input rule and
                // the same keyboard as everywhere (util/NumericInput.kt).
                OutlinedTextField(
                    shape = Shapes.field,
                    value = threshold,
                    onValueChange = { threshold = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.wanted_threshold)) },
                    singleLine = true,
                    keyboardOptions = NumericInput.priceKeyboard(),
                    modifier = Modifier.fillMaxWidth(),
                )
    }
}
