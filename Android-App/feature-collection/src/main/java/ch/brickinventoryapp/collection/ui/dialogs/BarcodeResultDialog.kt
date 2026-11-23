package ch.brickinventoryapp.collection.ui.dialogs

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.ConditionRow
import ch.brickinventoryapp.shared.ui.CountField
import ch.brickinventoryapp.shared.ui.InfoBadge
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.PurchasePriceField
import ch.brickinventoryapp.shared.ui.StorageLocationEntry
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.util.fmtInt
import coil3.ImageLoader
import coil3.request.crossfade

/**
 * The dialog after a successful barcode scan: confirm the set (or parts list
 * entry), enter quantity, purchase price, condition and owner.
 *
 * The condition `if (barcodeState.result != null)` stays with the caller: that way
 * when it appears stands in one place, and here only how it looks.
 */
@Composable
internal fun BarcodeResultRoute(vm: EntryViewModel, imageLoader: ImageLoader) {
    val state by vm.state.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()
    val storageUiState by vm.storageState.collectAsStateWithLifecycle()
    BarcodeResultDialog(BarcodeDialogState(state, glance, barcodeState, storageUiState), vm, imageLoader)
}

/** What the barcode dialog shows. */
data class BarcodeDialogState(
    val state: AppUiState,
    val glance: ScopeUiState,
    val barcodeState: BarcodeUiState,
    val storageUiState: StorageUiState,
)

@Composable
fun BarcodeResultDialog(condition: BarcodeDialogState, actions: EntryActions, imageLoader: ImageLoader) {
    val state = condition.state
    val glance = condition.glance
    val barcodeState = condition.barcodeState
    if (barcodeState.result == null) return

    // Fresh per scanned barcode, and across a rotation (rememberSaveable): price
    // and storage location got lost on rotating.
    var barcodeQuantity by rememberSaveable(barcodeState.result) { mutableStateOf("1") }
    var barcodePriceText by rememberSaveable(barcodeState.result) { mutableStateOf("") }
    var barcodeUiState by rememberSaveable(barcodeState.result) { mutableStateOf(state.userDefaultCondition ?: Condition.NEW) }
    // Pre-fill the owner as in the gallery dialog: one's own account. The repository, API
    // and server all accept it, so this path has to ask for it too.
    var barcodeOwner by rememberSaveable(barcodeState.result, glance.householdMembers) {
        mutableStateOf(glance.householdMembers.firstOrNull { it.isSelf }?.id)
    }
    // Storage location reset to the default, not to empty, so it's
    // preselected on a new entry; the default can arrive after the scan.
    val storageUiState = condition.storageUiState
    val storageDefault = storageUiState.default?.name ?: ""
    var barcodeLocation by rememberSaveable(barcodeState.result, storageDefault) { mutableStateOf(storageDefault) }
    val forPartList = barcodeState.source == ScannerOrigin.PART_LIST
    // The same frame as "Add set": title, fields stacked, the full-width button on the right.
    AddDialog(
        title = if (forPartList) stringResource(R.string.main_barcode_add_partslist)
                else stringResource(R.string.main_barcode_add_set),
        confirm = stringResource(R.string.barcode_add),
        // The lock against double entry sits in confirmAddBarcode(); here you just see
        // that the tap registered.
        confirmEnabled = !barcodeState.add.running,
        onConfirm = {
            if (forPartList) {
                // Only the number: no inventory item comes from a parts list entry.
                actions.confirmAddBarcode(EntryRequest(barcodeState.result))
            } else {
                actions.confirmAddBarcode(EntryRequest(
                    setNumber = barcodeState.result,
                    quantity = barcodeQuantity.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                    purchasePrice = NumericInput.readMoney(barcodePriceText),
                    condition = barcodeUiState,
                    // Without a household, send nothing at all — the server then stays on
                    // one's own account (same rule as in the gallery dialog).
                    owner = if (glance.householdMembers.size > 1) barcodeOwner else null,
                    storageLocation = barcodeLocation.trim().takeIf { it.isNotEmpty() },
                ))
            }
        },
        // Can't be closed while adding — the call is still running.
        onCancel = { if (!barcodeState.add.running) actions.cancelBarcode() },
    ) {
        BarcodeFound(barcodeState, state.serverUrl, imageLoader, forPartList)
        // Entry fields only when entering into the collection. No inventory item comes
        // from a parts list entry — confirmAddBarcode() only passes the
        // number on in the parts list branch. Owner, purchase price and condition would be fields with no
        // effect there, looking like input that counts. Image, name, number and
        // figures stay: they help check that the right set was scanned.
        if (barcodeState.source != ScannerOrigin.PART_LIST) {
            // Purchase price right at entry (optional) — leaving it empty takes over
            // the current market price server-side (same logic as the web app).
            // OwnerPicker hides itself without a household
            // (members.size < 2 → return), hence no condition here.
            OwnerPicker(
                glance.householdMembers, barcodeOwner, { barcodeOwner = it }
            )
            // The same fields as "Add set": label, help line, check.
            CountField(barcodeQuantity, { barcodeQuantity = it }, stringResource(R.string.gallery_quantity_hint))
            PurchasePriceField(barcodePriceText, { barcodePriceText = it }, stringResource(R.string.barcode_purchase_price))
            ConditionRow(
                condition = barcodeUiState,
                onUiState = { barcodeUiState = it }
            )
            StorageLocationEntry(
                barcodeLocation,
                // The STOCK, not the occupied locations: entering should
                // also offer an empty shelf as an option.
                storageUiState.own.map { it.name },
                { barcodeLocation = it }
            )
        }
    }
}

/** What was found: the notice for a guessed number, image, name, ownership and the set's figures. */
@Composable
private fun BarcodeFound(barcodeState: BarcodeUiState, serverUrl: String, imageLoader: ImageLoader, forPartList: Boolean) {
    // ── Notice for a guessed number ──
    //
    // The dialog shows image and name; the notice says when a closer look is needed
    // (server with no EAN match, `utils/barcodeQuelle.ts`, or text recognition). Above, and
    // in the warning color, but without blocking the operation: the hit is often right,
    // and confirming should be a glance, not a click more.
    if (barcodeState.unsafe) UnsureNotice()
    val imgUrl = barcodeState.imageLocal?.let { "$serverUrl$it" } ?: barcodeState.imageUrl
    val ctx = androidx.compose.ui.platform.LocalContext.current
    ProductImage(
        model = imgUrl?.let { coil3.request.ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
        imageLoader = imageLoader,
        contentDescription = barcodeState.setName,
        modifier = Modifier.fillMaxWidth().height(160.dp).clip(MaterialTheme.shapes.medium),
        contentScale = ContentScale.Fit,
        fallbackSize = 56.dp,
    )
    // Name and number belong together, as on the box; the notice follows after.
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
        if (barcodeState.setName != null)
            Text(barcodeState.setName, fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small), verticalAlignment = Alignment.CenterVertically) {
            // The recognized set number is shown, not tapped: no link color.
            Text(barcodeState.result.orEmpty(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
            if (barcodeState.theme != null)
                Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.small) {
                    Text(barcodeState.theme, Modifier.padding(horizontal = 6.dp, vertical = Spacing.hairline),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
        }
    }
    // As in the catalog: whoever already has a set should see it before entering it a second time.
    if (barcodeState.ownershipQuantity > 0 && !forPartList)
        InfoBadge(stringResource(R.string.barcode_already_owned, barcodeState.ownershipQuantity), icon = Icons.Default.Check)
    HorizontalDivider()
    BarcodeStats(barcodeState)
}

/**
 * Notice for a guessed number: in the warning color, but without blocking the operation — the hit
 * is often right, and confirming should be a glance, not a click more.
 */
@Composable
private fun UnsureNotice() {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = Spacing.small),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Warning, null, Modifier.size(withFont(20.dp)),
                tint = MaterialTheme.colorScheme.onErrorContainer)
            Text(
                stringResource(R.string.main_barcode_unsure),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

/** Year, pieces and minifigures of the found set, each with its icon. */
@Composable
private fun BarcodeStats(barcodeState: BarcodeUiState) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
        if (barcodeState.year != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.CalendarMonth, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${barcodeState.year}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.main_barcode_year), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (barcodeState.pieces != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(withFont(18.dp)), tint = Color.Unspecified)
            Text(fmtInt(barcodeState.pieces), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.main_barcode_pieces), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (barcodeState.minifigs != null && barcodeState.minifigs > 0)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Person, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${barcodeState.minifigs}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.main_barcode_figs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
    }
}
