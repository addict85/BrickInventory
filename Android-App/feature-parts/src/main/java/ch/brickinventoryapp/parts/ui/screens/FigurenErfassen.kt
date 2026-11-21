package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.shared.ui.erfassungsWerte
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.shared.ui.ErfassungsFelder
import ch.brickinventoryapp.shared.ui.OwnerPicker

@Composable
internal fun AddMinifigDialog(
    onDismiss: () -> Unit,
    onAdd: (Figurenerfassung) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** The household's accounts — without sub-accounts the choice stays hidden. */
    householdMembers: List<MemberView> = emptyList(),
    /** Supply of storage locations — empty means: there are none yet, then one types it. */
    lagerorte: List<String> = emptyList(),
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
    var lagerort   by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Pre-filled with one's own account: whoever chooses nothing enters for themselves —
    // the same behavior as before the household view.
    val eigenes = householdMembers.firstOrNull { it.isSelf }?.id
    var owner by remember(householdMembers) { mutableStateOf(eigenes) }
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (figNumber.isBlank()) numberMissing = true
        else if (!entryInvalid(quantity, unitPrice)) {
            // See erfassungsWerte() — the same conversion as in the parts dialog.
            val w = erfassungsWerte(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(Figurenerfassung(
                nummer = figNumber,
                blNumber = blFigNumber.trim().ifBlank { null },
                menge = w.anzahl, stueckpreis = w.preis, zustand = w.zustand, besitzer = w.besitzer,
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Like AddPartDialog: closed only via onAdd, an error leaves everything as is.
    AddDialog(
        titel = stringResource(R.string.minifigs_add_title),
        bestaetigen = stringResource(R.string.minifigs_add_button),
        onBestaetigen = { submit() },
        onAbbrechen = onDismiss,
        confirmAn = !entryInvalid(quantity, unitPrice),
        geaendert = figNumber.isNotBlank() || blFigNumber.isNotBlank() || quantity != "1" || unitPrice.isNotEmpty() ||
            condition != defaultCondition || lagerort != locationDefault || owner != eigenes,
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        NumberField(figNumber, { figNumber = it }, numberMissing, R.string.minifigs_fig_number,
            R.string.minifigs_fig_number_placeholder, R.string.minifigs_nummer_fehlt)
        OutlinedTextField(
            value = blFigNumber, onValueChange = { blFigNumber = it },
            label = { Text(stringResource(R.string.minifigs_bl_number)) },
            // The hint about the BrickLink number belongs at the field, not as a loose row below it.
            supportingText = { Text(stringResource(R.string.minifigs_bl_hint)) },
            placeholder = { Text(stringResource(R.string.minifigs_bl_number_placeholder)) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld
        )
        ErfassungsFelder(
            anzahl = quantity, onCount = { quantity = it },
            countHint = stringResource(R.string.minifigs_quantity_hint),
            preis = unitPrice, onPrice = { unitPrice = it },
            zustand = condition, onZustand = { condition = it },
            lagerort = lagerort, onLocation = { lagerort = it },
            lagerorte = lagerorte,
        )
    }
}
