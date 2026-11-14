package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.ui.theme.farbeAusHex
import ch.brickinventoryapp.gemeinsam.ui.erfassungUngueltig
import ch.brickinventoryapp.gemeinsam.ui.erfassungsWerte
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
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
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.ui.model.FarbeAnsicht
import ch.brickinventoryapp.model.ui.model.OHNE_FARBE
import ch.brickinventoryapp.model.ui.ohneKeineFarbe
import androidx.compose.material3.ExperimentalMaterial3Api
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ErfassenDialog
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.gemeinsam.ui.ErfassungsFelder
import ch.brickinventoryapp.gemeinsam.ui.OwnerPicker

@Composable
internal fun AddPartDialog(
    colors: List<FarbeAnsicht> = emptyList(),
    onDismiss: () -> Unit,
    onAdd: (Teilerfassung) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<MitgliedAnsicht> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
) {
    var partNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    // Die Id statt der Farbe: FarbeAnsicht passt in kein Bundle, und nach einer Drehung
    // stünde sonst wieder „keine Farbe“ da, während alles andere blieb.
    var farbId by rememberSaveable { mutableStateOf<Int?>(null) }
    val selectedColor = colors.firstOrNull { it.id == farbId }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // Schluessel ist die Vorgabe — dieselbe Begruendung wie im Galerie-Dialog:
    // Sie kommt ueber das Netz und kann nach dem Oeffnen eintreffen.
    var lagerort   by rememberSaveable(lagerortVorgabe) { mutableStateOf(lagerortVorgabe) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    val eigenes = householdMembers.firstOrNull { it.isSelf }?.id
    var owner by remember(householdMembers) { mutableStateOf(eigenes) }
    // Wie beim Set: Hinzufügen bleibt bei leerer Nummer antippbar und markiert das Feld.
    var nummerFehlt by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (partNumber.isBlank()) nummerFehlt = true
        else if (!erfassungUngueltig(quantity, unitPrice)) {
            val w = erfassungsWerte(quantity, unitPrice, condition, owner, householdMembers)
            onAdd(Teilerfassung(
                nummer = partNumber,
                farbId = selectedColor?.id ?: OHNE_FARBE, farbname = selectedColor?.name, farbHex = selectedColor?.hex,
                menge = w.anzahl, stueckpreis = w.preis, zustand = w.zustand, besitzer = w.besitzer,
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Geschlossen wird nur über onAdd: Der Aufrufer schliesst dort, ein Fehler lässt alles stehen.
    ErfassenDialog(
        titel = stringResource(R.string.parts_add_title),
        bestaetigen = stringResource(R.string.parts_add_button),
        onBestaetigen = { submit() },
        onAbbrechen = onDismiss,
        bestaetigenAn = !erfassungUngueltig(quantity, unitPrice),
        geaendert = partNumber.isNotBlank() || quantity != "1" || unitPrice.isNotEmpty() || farbId != null ||
            condition != defaultCondition || lagerort != lagerortVorgabe || owner != eigenes,
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        NummerFeld(partNumber, { partNumber = it }, nummerFehlt, R.string.parts_part_number,
            R.string.parts_part_number_placeholder, R.string.parts_nummer_fehlt)
        FarbWahl(colors, selectedColor) { farbId = it?.id }
        ErfassungsFelder(
            anzahl = quantity, onAnzahl = { quantity = it },
            preis = unitPrice, onPreis = { unitPrice = it },
            zustand = condition, onZustand = { condition = it },
            lagerort = lagerort, onLagerort = { lagerort = it },
            lagerorte = lagerorte,
        )
    }
}

/**
 * Das Nummernfeld der manuellen Erfassung. Der Fehler erscheint erst nach dem ersten
 * Versuch und am Feld selbst: Vorher schloss der Dialog still, und die Eingaben waren weg.
 */
@Composable
internal fun NummerFeld(
    wert: String,
    onWert: (String) -> Unit,
    fehltMarkiert: Boolean,
    beschriftung: Int,
    beispiel: Int,
    fehlt: Int,
) {
    val fehler = fehltMarkiert && wert.isBlank()
    OutlinedTextField(
        value = wert, onValueChange = onWert,
        label = { Text(stringResource(beschriftung)) },
        isError = fehler,
        supportingText = {
            if (fehler) Text(stringResource(fehlt), Modifier.ansagen()) else Text(stringResource(beispiel))
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.feld,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FarbWahl(colors: List<FarbeAnsicht>, gewaehlt: FarbeAnsicht?, onWahl: (FarbeAnsicht?) -> Unit) {
    var offen by rememberSaveable { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = offen, onExpandedChange = { offen = it }) {
        OutlinedTextField(
            value = gewaehlt?.name ?: stringResource(R.string.parts_no_color),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.parts_color_label)) },
            leadingIcon = {
                val swatch = farbeAusHex(gewaehlt?.hex)
                if (swatch != null) {
                    Box(Modifier.padding(start = Abstaende.mittel).size(14.dp).clip(CircleShape).background(swatch))
                }
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
            ohneKeineFarbe(colors).forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.name) },
                    leadingIcon = {
                        val swatch = farbeAusHex(c.hex)
                        if (swatch != null) Box(Modifier.size(14.dp).clip(CircleShape).background(swatch))
                    },
                    onClick = { onWahl(c); offen = false }
                )
            }
        }
    }
}
