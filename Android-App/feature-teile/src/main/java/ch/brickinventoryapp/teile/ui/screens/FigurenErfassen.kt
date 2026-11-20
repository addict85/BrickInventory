package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.gemeinsam.ui.entryInvalid
import ch.brickinventoryapp.gemeinsam.ui.erfassungsWerte
import ch.brickinventoryapp.model.fach.MemberView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.gemeinsam.ui.ErfassungsFelder
import ch.brickinventoryapp.gemeinsam.ui.OwnerPicker

@Composable
internal fun AddMinifigDialog(
    onDismiss: () -> Unit,
    onAdd: (Figurenerfassung) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<MemberView> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    locationDefault: String = "",
) {
    var figNumber  by rememberSaveable { mutableStateOf("") }
    var blFigNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // Schluessel ist die Vorgabe — dieselbe Begruendung wie im Galerie-Dialog:
    // Sie kommt ueber das Netz und kann nach dem Oeffnen eintreffen.
    var lagerort   by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    val eigenes = householdMembers.firstOrNull { it.isSelf }?.id
    var owner by remember(householdMembers) { mutableStateOf(eigenes) }
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (figNumber.isBlank()) numberMissing = true
        else if (!entryInvalid(quantity, unitPrice)) {
            // Siehe erfassungsWerte() — dieselbe Umrechnung wie im Teile-Dialog.
            val w = erfassungsWerte(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(Figurenerfassung(
                nummer = figNumber,
                blNumber = blFigNumber.trim().ifBlank { null },
                menge = w.anzahl, stueckpreis = w.preis, zustand = w.zustand, besitzer = w.besitzer,
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Wie AddPartDialog: Geschlossen wird nur über onAdd, ein Fehler lässt alles stehen.
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
            // Der Hinweis zur BrickLink-Nummer gehört ans Feld, nicht als lose Zeile darunter.
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
