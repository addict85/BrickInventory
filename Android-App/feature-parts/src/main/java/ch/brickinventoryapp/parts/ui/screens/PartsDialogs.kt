package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.shared.ui.entryValues
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Shapes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR
import ch.brickinventoryapp.model.ui.withoutNoColor
import androidx.compose.material3.ExperimentalMaterial3Api
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.shared.ui.EntryFields
import ch.brickinventoryapp.shared.ui.OwnerPicker

@Composable
internal fun AddPartDialog(
    colors: List<ColorView> = emptyList(),
    onDismiss: () -> Unit,
    onAdd: (PartEntry) -> Unit,
    defaultCondition: Condition = Condition.NEW,
    /** The household's accounts — without sub-accounts the choice stays hidden. */
    householdMembers: List<MemberView> = emptyList(),
    /** Supply of storage locations — empty means: there are none yet, then one types it. */
    storageLocations: List<String> = emptyList(),
    /** The preselected storage location (starred in settings). Empty means: no default. */
    locationDefault: String = "",
) {
    var partNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    // The id instead of the color: ColorView does not fit into any bundle, and after a rotation
    // it would otherwise read "keine Farbe" again while everything else stayed.
    var colorId by rememberSaveable { mutableStateOf<Int?>(null) }
    val selectedColor = colors.firstOrNull { it.id == colorId }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // The key is the default — the same reasoning as in the gallery dialog:
    // it comes over the network and can arrive after opening.
    var storageLocation   by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Pre-filled with one's own account: whoever chooses nothing enters for themselves —
    // the same behavior as before the household view.
    val own = householdMembers.firstOrNull { it.isSelf }?.id
    var owner by remember(householdMembers) { mutableStateOf(own) }
    // As for the set: adding stays tappable with an empty number and marks the field.
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (partNumber.isBlank()) numberMissing = true
        else if (!entryInvalid(quantity, unitPrice)) {
            val w = entryValues(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(PartEntry(
                number = partNumber,
                colorId = selectedColor?.id ?: WITHOUT_COLOR, colorName = selectedColor?.name, colorHex = selectedColor?.hex,
                quantity = w.count, unitPrice = w.price, condition = w.condition, owner = w.owner,
                storageLocation = storageLocation.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Closed only via onAdd: the caller closes it there, an error leaves everything as is.
    AddDialog(
        title = stringResource(R.string.parts_add_title),
        confirm = stringResource(R.string.parts_add_button),
        onConfirm = { submit() },
        onCancel = onDismiss,
        confirmEnabled = !entryInvalid(quantity, unitPrice),
        changed = partNumber.isNotBlank() || quantity != "1" || unitPrice.isNotEmpty() || colorId != null ||
            condition != defaultCondition || storageLocation != locationDefault || owner != own,
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        NumberField(partNumber, { partNumber = it }, numberMissing, R.string.parts_part_number,
            R.string.parts_part_number_placeholder, R.string.parts_number_missing)
        ColorChoice(colors, selectedColor) { colorId = it?.id }
        EntryFields(
            count = quantity, onCount = { quantity = it },
            countHint = stringResource(R.string.parts_quantity_hint),
            price = unitPrice, onPrice = { unitPrice = it },
            condition = condition, onUiState = { condition = it },
            storageLocation = storageLocation, onLocation = { storageLocation = it },
            storageLocations = storageLocations,
        )
    }
}

/**
 * The manual entry's number field. The error appears only after the first
 * attempt and at the field itself: before, the dialog closed silently and the input was gone.
 */
@Composable
internal fun NumberField(
    value: String,
    onValue: (String) -> Unit,
    missingMarked: Boolean,
    label: Int,
    sample: Int,
    missing: Int,
) {
    val error = missingMarked && value.isBlank()
    OutlinedTextField(
        value = value, onValueChange = onValue,
        label = { Text(stringResource(label)) },
        isError = error,
        supportingText = {
            if (error) Text(stringResource(missing), Modifier.announce()) else Text(stringResource(sample))
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Shapes.field,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ColorChoice(colors: List<ColorView>, chosen: ColorView?, onChoice: (ColorView?) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = chosen?.name ?: stringResource(R.string.parts_no_color),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.parts_color_label)) },
            // Without a color, no icon slot: an empty slot indented "Keine Farbe" for no reason.
            leadingIcon = colorFromHex(chosen?.hex)?.let { swatch ->
                { Box(Modifier.padding(start = Spacing.medium).size(14.dp).clip(CircleShape).background(swatch)) }
            },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = true),
            singleLine = true,
            shape = Shapes.field
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.parts_no_color)) },
                onClick = { onChoice(null); open = false }
            )
            withoutNoColor(colors).forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.name) },
                    leadingIcon = {
                        val swatch = colorFromHex(c.hex)
                        if (swatch != null) Box(Modifier.size(14.dp).clip(CircleShape).background(swatch))
                    },
                    onClick = { onChoice(c); open = false }
                )
            }
        }
    }
}
