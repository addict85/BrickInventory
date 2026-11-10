package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.gemeinsam.ui.erfassungUngueltig
import ch.brickinventoryapp.gemeinsam.ui.erfassungsWerte
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.gemeinsam.ui.ErfassungsFelder
import ch.brickinventoryapp.gemeinsam.ui.OwnerPicker

@Composable
internal fun AddMinifigDialog(
    onDismiss: () -> Unit,
    onAdd: (Figurenerfassung) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<MitgliedAnsicht> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
) {
    var figNumber  by rememberSaveable { mutableStateOf("") }
    var blFigNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // Schluessel ist die Vorgabe — dieselbe Begruendung wie im Galerie-Dialog:
    // Sie kommt ueber das Netz und kann nach dem Oeffnen eintreffen.
    var lagerort   by rememberSaveable(lagerortVorgabe) { mutableStateOf(lagerortVorgabe) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    fun submit() {
        if (figNumber.isNotBlank() && !erfassungUngueltig(quantity, unitPrice)) {
            // Siehe erfassungsWerte() — dieselbe Umrechnung wie im Teile-Dialog.
            val w = erfassungsWerte(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(Figurenerfassung(
                nummer = figNumber,
                blNummer = blFigNumber.trim().ifBlank { null },
                menge = w.anzahl, stueckpreis = w.preis, zustand = w.zustand, besitzer = w.besitzer,
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text(stringResource(R.string.minifigs_add_title), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OwnerPicker(householdMembers, owner, { owner = it })
                OutlinedTextField(
                    value = figNumber, onValueChange = { figNumber = it },
                    label = { Text(stringResource(R.string.minifigs_fig_number)) }, placeholder = { Text(stringResource(R.string.minifigs_fig_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.feld
                )
                OutlinedTextField(
                    value = blFigNumber, onValueChange = { blFigNumber = it },
                    label = { Text(stringResource(R.string.minifigs_bl_number)) }, placeholder = { Text(stringResource(R.string.minifigs_bl_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.feld
                )
                Text(
                    stringResource(R.string.minifigs_bl_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                ErfassungsFelder(
                    anzahl = quantity, onAnzahl = { quantity = it },
                    preis = unitPrice, onPreis = { unitPrice = it },
                    zustand = condition, onZustand = { condition = it },
                    lagerort = lagerort, onLagerort = { lagerort = it },
                    lagerorte = lagerorte,
                )
            }
        },
        confirmButton = { TextButton(onClick = { submit(); onDismiss() }) { Text(stringResource(R.string.minifigs_add_button)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )
}
