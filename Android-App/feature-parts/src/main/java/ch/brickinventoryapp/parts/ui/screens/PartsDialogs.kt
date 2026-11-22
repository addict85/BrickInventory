package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.shared.ui.erfassungsWerte
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Formen
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
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.model.ui.withoutNoColor
import androidx.compose.material3.ExperimentalMaterial3Api
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.shared.ui.ErfassungsFelder
import ch.brickinventoryapp.shared.ui.OwnerPicker

@Composable
internal fun AddPartDialog(
    colors: List<ColorView> = emptyList(),
    onDismiss: () -> Unit,
    onAdd: (Teilerfassung) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** The household's accounts — without sub-accounts the choice stays hidden. */
    householdMembers: List<MemberView> = emptyList(),
    /** Supply of storage locations — empty means: there are none yet, then one types it. */
    lagerorte: List<String> = emptyList(),
    /** The preselected storage location (starred in settings). Empty means: no default. */
    locationDefault: String = "",
) {
    var partNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    // The id instead of the color: ColorView does not fit into any bundle, and after a rotation
    // it would otherwise read "keine Farbe" again while everything else stayed.
    var farbId by rememberSaveable { mutableStateOf<Int?>(null) }
    val selectedColor = colors.firstOrNull { it.id == farbId }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // The key is the default — the same reasoning as in the gallery dialog:
    // it comes over the network and can arrive after opening.
    var lagerort   by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Pre-filled with one's own account: whoever chooses nothing enters for themselves —
    // the same behavior as before the household view.
    val eigenes = householdMembers.firstOrNull { it.isSelf }?.id
    var owner by remember(householdMembers) { mutableStateOf(eigenes) }
    // As for the set: adding stays tappable with an empty number and marks the field.
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (partNumber.isBlank()) numberMissing = true
        else if (!entryInvalid(quantity, unitPrice)) {
            val w = erfassungsWerte(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(Teilerfassung(
                nummer = partNumber,
                farbId = selectedColor?.id ?: OHNE_FARBE, farbname = selectedColor?.name, farbHex = selectedColor?.hex,
                menge = w.anzahl, stueckpreis = w.preis, zustand = w.zustand, besitzer = w.besitzer,
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Closed only via onAdd: the caller closes it there, an error leaves everything as is.
    AddDialog(
        titel = stringResource(R.string.parts_add_title),
        bestaetigen = stringResource(R.string.parts_add_button),
        onBestaetigen = { submit() },
        onAbbrechen = onDismiss,
        confirmAn = !entryInvalid(quantity, unitPrice),
        geaendert = partNumber.isNotBlank() || quantity != "1" || unitPrice.isNotEmpty() || farbId != null ||
            condition != defaultCondition || lagerort != locationDefault || owner != eigenes,
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        NumberField(partNumber, { partNumber = it }, numberMissing, R.string.parts_part_number,
            R.string.parts_part_number_placeholder, R.string.parts_nummer_fehlt)
        FarbChoice(colors, selectedColor) { farbId = it?.id }
        ErfassungsFelder(
            anzahl = quantity, onCount = { quantity = it },
            countHint = stringResource(R.string.parts_quantity_hint),
            preis = unitPrice, onPrice = { unitPrice = it },
            zustand = condition, onZustand = { condition = it },
            lagerort = lagerort, onLocation = { lagerort = it },
            lagerorte = lagerorte,
        )
    }
}

/**
 * The manual entry's number field. The error appears only after the first
 * attempt and at the field itself: before, the dialog closed silently and the input was gone.
 */
@Composable
internal fun NumberField(
    wert: String,
    onValue: (String) -> Unit,
    missingMarked: Boolean,
    beschriftung: Int,
    beispiel: Int,
    fehlt: Int,
) {
    val fehler = missingMarked && wert.isBlank()
    OutlinedTextField(
        value = wert, onValueChange = onValue,
        label = { Text(stringResource(beschriftung)) },
        isError = fehler,
        supportingText = {
            if (fehler) Text(stringResource(fehlt), Modifier.announce()) else Text(stringResource(beispiel))
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.feld,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FarbChoice(colors: List<ColorView>, gewaehlt: ColorView?, onWahl: (ColorView?) -> Unit) {
    var offen by rememberSaveable { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = offen, onExpandedChange = { offen = it }) {
        OutlinedTextField(
            value = gewaehlt?.name ?: stringResource(R.string.parts_no_color),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.parts_color_label)) },
            // Without a color, no icon slot: an empty slot indented "Keine Farbe" for no reason.
            leadingIcon = colorFromHex(gewaehlt?.hex)?.let { swatch ->
                { Box(Modifier.padding(start = Abstaende.mittel).size(14.dp).clip(CircleShape).background(swatch)) }
            },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = true),
            singleLine = true,
            shape = Formen.feld
        )
        ExposedDropdownMenu(expanded = offen, onDismissRequest = { offen = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.parts_no_color)) },
                onClick = { onWahl(null); offen = false }
            )
            withoutNoColor(colors).forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.name) },
                    leadingIcon = {
                        val swatch = colorFromHex(c.hex)
                        if (swatch != null) Box(Modifier.size(14.dp).clip(CircleShape).background(swatch))
                    },
                    onClick = { onWahl(c); offen = false }
                )
            }
        }
    }
}
