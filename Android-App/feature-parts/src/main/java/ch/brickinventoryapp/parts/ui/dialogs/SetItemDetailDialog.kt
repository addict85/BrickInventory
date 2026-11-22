package ch.brickinventoryapp.parts.ui.dialogs

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.parts.ui.screens.PartDetailHeader
import ch.brickinventoryapp.parts.ui.viewmodel.SetItemActions
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.LocationField
import ch.brickinventoryapp.shared.ui.TableRow
import ch.brickinventoryapp.shared.ui.quantityFromSet
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.components.BackButton
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.ui.components.colorTranslator
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader

/**
 * Detail for a part / figure from a set, on the phone as a sheet from the bottom:
 * an image with zoom and the sets that use it, with a link to the set detail. A sheet
 * instead of a dialog, because storage location and list need room and swiping
 * down closes it as everywhere else.
 */
@Composable
internal fun SetItemDetailDialog(
    condition: SetItemUiState,
    storageUiState: StorageUiState,
    actions: SetItemActions,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    SetItemDetail(condition, storageUiState, actions, imageLoader, serverUrl, onOpenSet, asDialog = true)
}

/**
 * The same detail as the right half next to the list (tablet, list-detail as in
 * the wishlist): title with a close button, the content below it, scrollable.
 */
@Composable
internal fun SetItemDetailArea(
    condition: SetItemUiState,
    storageUiState: StorageUiState,
    actions: SetItemActions,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    SetItemDetail(condition, storageUiState, actions, imageLoader, serverUrl, onOpenSet, asDialog = false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SetItemDetail(
    condition: SetItemUiState,
    storageUiState: StorageUiState,
    actions: SetItemActions,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
    asDialog: Boolean,
) {
    val color = colorTranslator()
    // The selection list belongs to the part's owner; it comes with the header (PartsViewModel).
    if (!condition.open) return

    // rememberSaveable, not remember: the opened zoom is a decision of the
    // user and must survive a rotation — as at the other zoom spots.
    var showZoom by rememberSaveable { mutableStateOf(false) }
    // stringResource() only works outside the LazyColumn's body — there
    // no Composable context is needed for every item, and reading it once
    // is enough.
    val openLabel = stringResource(R.string.setitem_open_set)
    val header = condition.header
    // Full resolution VIA the server proxy — for parts and figures this is
    // deliberately decided this way (see resolveFullUrlViaProxy), so that no
    // device talks directly to the CDN past the server. The dialog for manually
    // entered parts makes exactly the same choice.
    val image = header?.let { resolveFullUrlViaProxy(serverUrl, it.imageLocal, it.imageUrl) }

    val title: @Composable () -> Unit = {
            Column {
                Text(header?.name ?: condition.number, fontWeight = FontWeight.SemiBold)
                Text(
                    condition.number + (header?.colorName?.let { " · " + color(it) } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
    }
    val content: @Composable () -> Unit = {
            Column(Modifier.fillMaxWidth()) {
                when {
                    condition.fetch.loading -> Box(Modifier.fillMaxWidth().padding(Spacing.veryLarge), Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                    condition.fetch is Load.Failure -> Text(
                        condition.fetch.message.sentence(),
                        color = MaterialTheme.colorScheme.error,
                    )
                    else -> {
                        // The same header as for a self-entered part; only the sections below it
                        // depend on the origin.
                        val category = categoryTranslator()
                        val chips = buildList {
                            add(stringResource(R.string.setitem_total_qty) to quantityFromSet(header?.totalQuantity ?: 0))
                            header?.colorName?.let { add(stringResource(R.string.setitem_color) to color(it)) }
                            header?.categoryName?.let { add(stringResource(R.string.setitem_category) to category(it)) }
                            if (header?.isSpare == true) add(stringResource(R.string.parts_spare_tag) to "✓")
                        }
                        PartDetailHeader(image, imageLoader, header?.name, chips, onZoom = { showZoom = true })
                        Spacer(Modifier.height(Spacing.small))
                        // Only for parts (kopf.colorId is null for figures): a minifigure
                        // is stuck in its set, whose location stands in the set detail — a second
                        // location could drift apart. Editable as in the web app; the
                        // field writes to every row of this part-color pair.
                        val headerColor = header?.colorId
                        if (header != null && headerColor != null) {
                            Row(Modifier.fillMaxWidth().padding(vertical = Spacing.hairline),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.detail_storage),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodyMedium)
                                LocationField(
                                    value = header.storage ?: "",
                                    stock = storageUiState.stock.map { it.name },
                                    onValue = { actions.setPartLocation(header.number, headerColor, it) },
                                    modifier = Modifier.padding(start = Spacing.large)
                                        .weight(1f).widthIn(max = 320.dp),
                                )
                            }
                        }
                        Spacer(Modifier.height(Spacing.medium))
                        Text(
                            stringResource(R.string.setitem_used_in),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (condition.sets.isEmpty()) {
                            Text(
                                stringResource(R.string.setitem_used_in_none),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } else {
                            // LazyColumn with a height limit: a part can be
                            // stuck in dozens of sets, and a dialog that grows
                            // beyond the screen edge can no longer be
                            // closed.
                            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                                items(condition.sets, key = { it.setNumber + "-" + it.ownerUserId }) { s ->
                                    // ── Image, number, name, quantity ──
                                    //
                                    // First the small image, then number, then name — as in the
                                    // finances tab. TableRow exists for that; a row of its
                                    // own would have a fixed corner radius and no fallback to the full
                                    // resolution without a thumbnail.
                                    val (imageUrl, onImageError) =
                                        rememberTileImageWithFallback(serverUrl, s.imageLocal, s.imageUrl)
                                    TableRow(
                                        imageUrl = imageUrl,
                                        number = s.setNumber,
                                        name = s.setName,
                                        quantity = s.quantity,
                                        imageLoader = imageLoader,
                                        onImageError = onImageError,
                                        // onClickLabel tells the screen reader what tapping does
                                        // — without it, it only reads out the set number. In the web app
                                        // the same text is the title attribute.
                                        onClickLabel = openLabel,
                                        onClick = {
                                            // Close first, then open:
                                            // otherwise the dialog would lie
                                            // over the set detail.
                                            actions.closeSetItem()
                                            onOpenSet(s.setNumber)
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
    }

    // Close on the left as in every detail header (DetailTopAppBar), in the sheet as next to the list.
    val close = { actions.closeSetItem() }
    if (asDialog) {
        ModalBottomSheet(onDismissRequest = close) {
            Column(
                Modifier.padding(start = Spacing.large, end = Spacing.veryLarge, bottom = Spacing.veryLarge)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Spacing.medium),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BackButton(close, close = true)
                    Box(Modifier.weight(1f)) {
                        ProvideTextStyle(MaterialTheme.typography.titleLarge) { title() }
                    }
                }
                content()
            }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            DetailTopAppBar(
                title = header?.name ?: condition.number,
                subtitle = condition.number + (header?.colorName?.let { " · " + color(it) } ?: ""),
                onBack = close,
                close = true,
            )
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.large),
                verticalArrangement = Arrangement.spacedBy(Spacing.medium),
            ) { content() }
        }
    }

    if (showZoom && image != null) {
        ZoomableImageDialog(
            imageUrl = image,
            contentDescription = header.name,
            imageLoader = imageLoader,
            onDismiss = { showZoom = false },
        )
    }
}
