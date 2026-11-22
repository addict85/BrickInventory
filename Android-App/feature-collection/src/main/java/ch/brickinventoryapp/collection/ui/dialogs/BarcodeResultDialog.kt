package ch.brickinventoryapp.collection.ui.dialogs

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.shared.ui.InfoBadge
import ch.brickinventoryapp.ui.components.AddDialog
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.collection.ui.viewmodel.ErfassungAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.compose.*
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
import coil3.ImageLoader
import coil3.request.crossfade
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Column
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.shared.ui.LagerortErfassung
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.Zustandszeile
import ch.brickinventoryapp.shared.ui.CountField
import ch.brickinventoryapp.shared.ui.PurchasePriceField
import ch.brickinventoryapp.ui.util.fmtInt

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
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()
    val lagerZustand by vm.storageState.collectAsStateWithLifecycle()
    BarcodeResultDialog(BarcodeDialogZustand(state, blick, barcodeState, lagerZustand), vm, imageLoader)
}

/** What the barcode dialog shows. */
data class BarcodeDialogZustand(
    val state: AppUiState,
    val blick: ScopeUiState,
    val barcodeState: BarcodeUiState,
    val lagerZustand: LagerUiState,
)

@Composable
fun BarcodeResultDialog(zustand: BarcodeDialogZustand, aktionen: ErfassungAktionen, imageLoader: ImageLoader) {
    val state = zustand.state
    val blick = zustand.blick
    val barcodeState = zustand.barcodeState
    if (barcodeState.result == null) return

    // Fresh per scanned barcode, and across a rotation (rememberSaveable): price
    // and storage location got lost on rotating.
    var barcodeQuantity by rememberSaveable(barcodeState.result) { mutableStateOf("1") }
    var barcodePriceText by rememberSaveable(barcodeState.result) { mutableStateOf("") }
    var barcodeCondition by rememberSaveable(barcodeState.result) { mutableStateOf(state.userDefaultCondition ?: Zustand.NEU) }
    // Pre-fill the owner as in the gallery dialog: one's own account. The repository, API
    // and server all accept it, so this path has to ask for it too.
    var barcodeOwner by rememberSaveable(barcodeState.result, blick.householdMembers) {
        mutableStateOf(blick.householdMembers.firstOrNull { it.isSelf }?.id)
    }
    // Storage location reset to the default, not to empty, so it's
    // preselected on a new entry; the default can arrive after the scan.
    val lagerZustand = zustand.lagerZustand
    val storageDefault = lagerZustand.vorgabe?.name ?: ""
    var barcodeLocation by rememberSaveable(barcodeState.result, storageDefault) { mutableStateOf(storageDefault) }
    val forPartList = barcodeState.source == Scannerherkunft.TEILELISTE
    // The same frame as "Add set": title, fields stacked, the full-width button on the right.
    AddDialog(
        titel = if (forPartList) stringResource(R.string.main_barcode_add_partslist)
                else stringResource(R.string.main_barcode_add_set),
        bestaetigen = stringResource(R.string.barcode_add),
        // The lock against double entry sits in confirmAddBarcode(); here you just see
        // that the tap registered.
        confirmAn = !barcodeState.hinzufuegen.laeuft,
        onBestaetigen = {
            if (forPartList) {
                // Only the number: no inventory item comes from a parts list entry.
                aktionen.confirmAddBarcode(Erfassungswunsch(barcodeState.result))
            } else {
                aktionen.confirmAddBarcode(Erfassungswunsch(
                    setNumber = barcodeState.result,
                    menge = barcodeQuantity.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                    kaufpreis = NumericInput.readMoney(barcodePriceText),
                    zustand = barcodeCondition,
                    // Without a household, send nothing at all — the server then stays on
                    // one's own account (same rule as in the gallery dialog).
                    besitzer = if (blick.householdMembers.size > 1) barcodeOwner else null,
                    lagerort = barcodeLocation.trim().takeIf { it.isNotEmpty() },
                ))
            }
        },
        // Can't be closed while adding — the call is still running.
        onAbbrechen = { if (!barcodeState.hinzufuegen.laeuft) aktionen.cancelBarcode() },
    ) {
                // ── Notice for a guessed number ──
                //
                // The dialog shows image and name; the notice says when a closer look is needed
                // (server with no EAN match, utils/barcodeQuelle.ts, or text recognition). Above, and
                // in the warning color, but without blocking the operation: the hit is often right,
                // and confirming should be a glance, not a click more.
                if (barcodeState.unsicher) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            Modifier.padding(horizontal = 10.dp, vertical = Abstaende.klein),
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
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
                val imgUrl = barcodeState.imageLocal?.let { "${state.serverUrl}$it" } ?: barcodeState.imageUrl
                val ctx = androidx.compose.ui.platform.LocalContext.current
                ProduktBild(
                    model = imgUrl?.let { coil3.request.ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                    imageLoader = imageLoader,
                    contentDescription = barcodeState.setName,
                    modifier = Modifier.fillMaxWidth().height(160.dp).clip(MaterialTheme.shapes.medium),
                    contentScale = ContentScale.Fit,
                    fallbackSize = 56.dp,
                )
                // Name and number belong together, as on the box; the notice follows after.
                Column(verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                    if (barcodeState.setName != null)
                        Text(barcodeState.setName, fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein), verticalAlignment = Alignment.CenterVertically) {
                        // The recognized set number is shown, not tapped: no link color.
                        Text(barcodeState.result, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                        if (barcodeState.theme != null)
                            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.small) {
                                Text(barcodeState.theme, Modifier.padding(horizontal = 6.dp, vertical = Abstaende.hairline),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer)
                            }
                    }
                }
                // As in the catalog: whoever already has a set should see it before entering it a second time.
                if (barcodeState.ownershipQuantity > 0 && !forPartList)
                    InfoBadge(stringResource(R.string.barcode_schon_besessen, barcodeState.ownershipQuantity), icon = Icons.Default.Check)
                HorizontalDivider()
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
                // Entry fields only when entering into the collection. No inventory item comes
                // from a parts list entry — confirmAddBarcode() only passes the
                // number on in the TEILELISTE branch. Owner, purchase price and condition would be fields with no
                // effect there, looking like input that counts. Image, name, number and
                // figures stay: they help check that the right set was scanned.
                if (barcodeState.source != Scannerherkunft.TEILELISTE) {
                    // Purchase price right at entry (optional) — leaving it empty takes over
                    // the current market price server-side (same logic as the web app).
                    // OwnerPicker hides itself without a household
                    // (members.size < 2 → return), hence no condition here.
                    OwnerPicker(
                        blick.householdMembers, barcodeOwner, { barcodeOwner = it }
                    )
                    // The same fields as "Add set": label, help line, check.
                    CountField(barcodeQuantity, { barcodeQuantity = it }, stringResource(R.string.gallery_quantity_hint))
                    PurchasePriceField(barcodePriceText, { barcodePriceText = it }, stringResource(R.string.barcode_purchase_price))
                    Zustandszeile(
                        zustand = barcodeCondition,
                        onZustand = { barcodeCondition = it }
                    )
                    LagerortErfassung(
                        barcodeLocation,
                        // The STOCK, not the occupied locations: entering should
                        // also offer an empty shelf as an option.
                        lagerZustand.eigene.map { it.name },
                        { barcodeLocation = it }
                    )
                }
    }
}
