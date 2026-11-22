package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.shared.ui.entryValues
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Shapes
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.shared.ui.EntryFields
import ch.brickinventoryapp.shared.ui.OwnerPicker

@Composable
internal fun AddMinifigDialog(
    onDismiss: () -> Unit,
    onAdd: (FigureEntry) -> Unit,
    defaultCondition: Condition = Condition.NEW,
    /** The household's accounts — without sub-accounts the choice stays hidden. */
    householdMembers: List<MemberView> = emptyList(),
    /** Supply of storage locations — empty means: there are none yet, then one types it. */
    storageLocations: List<String> = emptyList(),
    /** The preselected storage location (starred in settings). Empty means: no default. */
    locationDefault: String = "",
) {
    var figNumber  by rememberSaveable { mutableStateOf("") }
    var blFigNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // The key is the default — the same reasoning as in the gallery dialog:
    // it comes over the network and can arrive after opening.
    var storageLocation   by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Pre-filled with one's own account: whoever chooses nothing enters for themselves —
    // the same behavior as before the household view.
    val own = householdMembers.firstOrNull { it.isSelf }?.id
    var owner by remember(householdMembers) { mutableStateOf(own) }
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (figNumber.isBlank()) numberMissing = true
        else if (!entryInvalid(quantity, unitPrice)) {
            // See entryValues() — the same conversion as in the parts dialog.
            val w = entryValues(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(FigureEntry(
                number = figNumber,
                blNumber = blFigNumber.trim().ifBlank { null },
                quantity = w.count, unitPrice = w.price, condition = w.condition, owner = w.owner,
                storageLocation = storageLocation.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Like AddPartDialog: closed only via onAdd, an error leaves everything as is.
    AddDialog(
        title = stringResource(R.string.minifigs_add_title),
        confirm = stringResource(R.string.minifigs_add_button),
        onConfirm = { submit() },
        onCancel = onDismiss,
        confirmEnabled = !entryInvalid(quantity, unitPrice),
        changed = figNumber.isNotBlank() || blFigNumber.isNotBlank() || quantity != "1" || unitPrice.isNotEmpty() ||
            condition != defaultCondition || storageLocation != locationDefault || owner != own,
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        NumberField(figNumber, { figNumber = it }, numberMissing, R.string.minifigs_fig_number,
            R.string.minifigs_fig_number_placeholder, R.string.minifigs_number_missing)
        OutlinedTextField(
            value = blFigNumber, onValueChange = { blFigNumber = it },
            label = { Text(stringResource(R.string.minifigs_bl_number)) },
            // The hint about the BrickLink number belongs at the field, not as a loose row below it.
            supportingText = { Text(stringResource(R.string.minifigs_bl_hint)) },
            placeholder = { Text(stringResource(R.string.minifigs_bl_number_placeholder)) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Shapes.field
        )
        EntryFields(
            count = quantity, onCount = { quantity = it },
            countHint = stringResource(R.string.minifigs_quantity_hint),
            price = unitPrice, onPrice = { unitPrice = it },
            condition = condition, onUiState = { condition = it },
            storageLocation = storageLocation, onLocation = { storageLocation = it },
            storageLocations = storageLocations,
        )
    }
}
