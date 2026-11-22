package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ConditionRow
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.StorageLocationEntry
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.NumericInput

/**
 * Quantity, purchase price and condition before taking over — no default is
 * reliably right for a set just bought. The same fields in the same order
 * as in the catalog dialog. The condition is pre-filled with the watchlist item's;
 * which watchlist item is fulfilled is decided by the server.
 */
@Composable
internal fun AdoptionDialog(
    wantedItem: WantedItemView,
    /** Stock of storage locations — empty means: there are none yet, then it's typed in. */
    storageLocations: List<String> = emptyList(),
    /** The preselected storage location (star in settings). Empty means: no default. */
    locationDefault: String = "",
    onDismiss: () -> Unit,
    onAdopt: (Int, String, Condition, String?) -> Unit,
) {
    var count   by rememberSaveable { mutableStateOf("1") }
    var price    by rememberSaveable { mutableStateOf("") }
    var condition  by rememberSaveable { mutableStateOf(wantedItem.condition) }
    // Key is the default — the same reasoning as in the catalog dialog.
    var storageLocation by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }

    AddDialog(
        title = stringResource(R.string.wanted_take),
        confirm = stringResource(R.string.wanted_take),
        onConfirm = { onAdopt(count.toIntOrNull() ?: 1, price, condition,
                                        storageLocation.trim().takeIf { it.isNotEmpty() }) },
        onCancel = onDismiss,
        changed = count != "1" || price.isNotEmpty() || condition != wantedItem.condition || storageLocation != locationDefault,
    ) {
        Text(wantedItem.name ?: wantedItem.setNumber, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
            // NumericInput instead of its own filtering: the rule for what counts as a number (exactly one
            // separator) lives once in util/NumericInput.kt.
            OutlinedTextField(
                shape = Shapes.field,
                value = count,
                onValueChange = { count = NumericInput.quantity(it) },
                label = { Text(stringResource(R.string.common_quantity)) },
                singleLine = true,
                keyboardOptions = NumericInput.integerKeyboard(),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                shape = Shapes.field,
                value = price,
                onValueChange = { price = NumericInput.price(it) },
                label = { Text(stringResource(R.string.gallery_purchase_price)) },
                singleLine = true,
                keyboardOptions = NumericInput.priceKeyboard(),
                modifier = Modifier.weight(1f),
            )
        }
        // Labeled "Condition": two chips with no heading didn't say what they ask about.
        ConditionRow(condition, { condition = it })
        // Storage location as with every other entry.
        StorageLocationEntry(storageLocation, storageLocations, { storageLocation = it })
    }
}

/**
 * The entry mask as a dialog, like AddSetDialog in the gallery — a card
 * would cost room on every screen. Number, condition, account; quantity and purchase price
 * only on taking over, a watchlist item has neither. The cursor goes into the
 * number field right away; the short pause before it is needed because the field isn't
 * laid out yet on the first pass.
 */
@Composable
internal fun WantedItemAddDialog(
    householdMembers: List<MemberView>,
    defaultCondition: Condition,
    onDismiss: () -> Unit,
    createOn: (String, Condition, Int?) -> Unit,
) {
    var number  by rememberSaveable { mutableStateOf("") }
    var condition by rememberSaveable { mutableStateOf(defaultCondition) }
    // Pre-filled with one's own account — whoever chooses nothing wants it for themself.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    // "Add to watchlist" stays tappable and then marks the empty field: gray with no
    // reason left you guessing why nothing happened.
    var numberMissing by rememberSaveable { mutableStateOf(false) }
    val numberFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        try { numberFocus.requestFocus() } catch (_: Exception) { /* dialog already closed */ }
    }

    AddDialog(
        title = stringResource(R.string.wanted_add_title),
        confirm = stringResource(R.string.wanted_add_submit),
        // Only send if there was a choice at all — otherwise the
        // server writes to one's own account.
        onConfirm = {
            if (number.isBlank()) numberMissing = true
            else createOn(number, condition, if (householdMembers.size > 1) owner else null)
        },
        onCancel = onDismiss,
        changed = number.isNotBlank() || condition != defaultCondition,
    ) {
        OutlinedTextField(
            value = number,
            onValueChange = { number = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            // As help text instead of a placeholder: the placeholder disappeared with
            // focus, and the dialog focuses the field right away.
            isError = numberMissing && number.isBlank(),
            supportingText = {
                if (numberMissing && number.isBlank()) Text(stringResource(R.string.record_number_missing), Modifier.announce())
                else Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            singleLine = true,
            shape = Shapes.field,
            // The same keyboard as in AddSetDialog. A number field
            // without a keyboard choice opens the letter keyboard — the
            // rule for that lives in NumericInputTest.
            keyboardOptions = NumericInput.setNumberKeyboard(),
            modifier = Modifier.fillMaxWidth().focusRequester(numberFocus),
        )
        // Labeled "Condition": two chips with no heading didn't say what they ask about.
        ConditionRow(condition, { condition = it })
        // The same picker as when entering a set. On a
        // single account it hides itself (members.size < 2).
        OwnerPicker(householdMembers, owner, { owner = it })
    }
}
