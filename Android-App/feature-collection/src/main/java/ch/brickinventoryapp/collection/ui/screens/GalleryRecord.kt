package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ConditionRow
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.PurchasePriceField
import ch.brickinventoryapp.shared.ui.StorageLocationEntry
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.QuantityStepper
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.util.NumericInput

/**
 * Enter a set. The STOCK of storage locations is on offer, not the occupied ones:
 * the filter list only contains places where something already sits; entering should
 * also offer an empty shelf as an option.
 */
@Composable
internal fun GalleryRecord(condition: GalleryState, events: GalleryEvents, onClose: () -> Unit) {
    AddSetDialog(
        onDismiss = onClose,
        onAdd = { wish -> onClose(); events.setRecord(wish) },
        householdMembers = condition.glance.householdMembers,
        defaultCondition = condition.app.userDefaultCondition ?: Condition.NEW,
        storageLocations = condition.storage.own.map { it.name },
        default = condition.storage.default?.name ?: "",
        currency = condition.app.currency,
    )
}

/** Without a household, send nothing at all — the server then stays on one's own account. */
private fun ownerForEntry(members: List<MemberView>, chosen: Int?): Int? =
    if (members.size > 1) chosen else null

/** If the dialog is already closed, requestFocus throws; then there's nothing left to focus. */
private fun FocusRequester.openFocusIf() {
    try { requestFocus() } catch (_: Exception) { /* dialog already closed */ }
}

@Composable
private fun FocusAfterPause(target: FocusRequester) = LaunchedEffect(Unit) {
    kotlinx.coroutines.delay(120)
    target.openFocusIf()
}

/**
 * The hint on the set-number field (null: nothing to flag). Before the first attempt to
 * save, the field stays quiet, so "75192-" doesn't already count as an error while typing.
 */
private fun numberError(number: String, checked: Boolean): Int? = when {
    !checked -> null
    number.isBlank() -> R.string.record_number_missing
    !NumericInput.isSetNumber(number) -> R.string.record_number_invalid
    else -> null
}

@Composable
fun AddSetDialog(
    onDismiss: () -> Unit,
    onAdd: (EntryRequest) -> Unit,
    defaultCondition: Condition = Condition.NEW,
    /** Household accounts — without sub-accounts, the picker stays hidden. */
    householdMembers: List<MemberView> = emptyList(),
    /** Stock of storage locations — empty means: there are none yet, then it's typed in. */
    storageLocations: List<String> = emptyList(),
    /**
     * The location that should already show (the star from settings); empty means
     * no default.
     */
    default: String = "",
    /** Shown at the purchase price; [CurrencyCode.NONE] shows none. */
    currency: CurrencyCode = CurrencyCode.NONE,
    /** Tests only: a blinking cursor never lets Robolectric settle. */
    immediatelyFocus: Boolean = true,
) {
    var setNumber by rememberSaveable { mutableStateOf("") }
    var quantity  by rememberSaveable { mutableIntStateOf(1) }
    // Key is the default: if it only arrives after the dialog opens, the field
    // takes it over; whatever someone has typed in the meantime stays, because the default
    // only changes once.
    var storageLocation  by rememberSaveable(default) { mutableStateOf(default) }

    // ── The cursor lands in the set field right away ──
    //
    // LaunchedEffect(Unit) runs once per display; the short pause before it is needed
    // because the field isn't laid out yet on the first pass and requestFocus()
    // would otherwise hit nothing.
    val setFieldFocus = remember { FocusRequester() }
    if (immediatelyFocus) FocusAfterPause(setFieldFocus)
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition by rememberSaveable { mutableStateOf(defaultCondition) }
    // Pre-filled with one's own account: whoever chooses nothing enters for themself —
    // the same behavior as before the household view.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }
    val keyboard  = LocalSoftwareKeyboardController.current
    // Add stays tappable and then marks the empty field: gray with no reason left
    // you guessing why nothing happened.
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (numberError(setNumber, checked = true) != null) {
            numberMissing = true
            if (immediatelyFocus) setFieldFocus.openFocusIf()
        } else if (!NumericInput.priceInvalid(purchasePrice)) {
            // On an unreadable price the dialog stays open; the fields show the error.
            onAdd(EntryRequest(
                setNumber = setNumber,
                quantity = quantity,
                purchasePrice = NumericInput.readMoney(purchasePrice),
                condition = condition,
                owner = ownerForEntry(householdMembers, owner),
                storageLocation = storageLocation.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // The same frame as every entry (AddDialog): title on the left, without an icon.
    AddDialog(
        title = stringResource(R.string.gallery_add_set_title),
        confirm = stringResource(R.string.gallery_add),
        onConfirm = { submit() },
        onCancel = onDismiss,
        changed = setNumber.isNotBlank() || quantity != 1 || purchasePrice.isNotEmpty() ||
            condition != defaultCondition || storageLocation != default,
        // Without its own "please enter set number" line: the same hint three times
        // at 200% pushed the buttons out of frame; what's missing is said by the field once typing starts.
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        // The example as help text as in the watchlist-item dialog: a placeholder would disappear
        // with focus, and the dialog focuses the field right away.
        OutlinedTextField(
            value = setNumber,
            onValueChange = { setNumber = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            isError = numberError(setNumber, numberMissing) != null,
            supportingText = {
                numberError(setNumber, numberMissing)?.let { Text(stringResource(it), Modifier.announce()) }
                    ?: Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            modifier = Modifier.fillMaxWidth().focusRequester(setFieldFocus), singleLine = true,
            shape = Shapes.field,
            keyboardOptions = NumericInput.setNumberKeyboard()
        )
        QuantityStepper(quantity, onFewer = { if (quantity > 1) quantity-- }, onMore = { quantity++ })
        PurchasePriceField(purchasePrice, { purchasePrice = it }, stringResource(R.string.gallery_purchase_price), currency) {
            keyboard?.hide(); submit()
        }
        ConditionRow(condition = condition, onUiState = { condition = it })
        StorageLocationEntry(storageLocation, storageLocations, { storageLocation = it })
    }
}
