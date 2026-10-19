package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.graphics.toColorInt
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.BrickColor
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.Schrift

/**
 * Die Farbe eines manuell erfassten Teils auswaehlen — zum KORRIGIEREN.
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 *
 * Marcos Bitte vom 19.10., nach dem Import mehrerer BrickLink-Wanted-Listen:
 * „Die Farbe wurde nicht immer uebernommen und die Teile sind nun mehrfach
 *  vorhanden (bsp 3001). … Weiter moechte ich die Farbe nachtraeglich
 *  anpassen koennen fuer den Fall dass diese nicht korrekt geladen wurde."
 *
 * ── Warum nicht AddPartDialog's Auswahl wiederverwendet ─────────────────────
 *
 * Die dort ist in den Dialog eingebaut und arbeitet auf einem `BrickColor?`,
 * das sie selbst haelt („noch nichts gewaehlt" = null). Hier gibt es keinen
 * Zustand „noch nichts": Das Teil HAT eine Farbe, sie ist nur falsch. Die
 * aktuelle muss darum von aussen kommen und auch dann anzeigbar sein, wenn die
 * Liste sie nicht kennt.
 *
 * Diese zweite Lage ist der Grund fuer [aktuellerName] und [aktuellerHex]: Die
 * Farbliste kommt ueber das Netz und kann leer sein (kein Rebrickable-
 * Schluessel, kein Netz). Dann steht hier trotzdem die heutige Farbe statt
 * eines leeren Feldes — und die Liste bleibt zu, weil es nichts zu waehlen
 * gibt.
 *
 * Eine Wahl speichert SOFORT, ohne Ruhezeit: Sie ist fertig in dem Moment, in
 * dem sie getroffen wird (dieselbe Begruendung wie bei der Ortswahl in
 * [LagerortFeld]).
 *
 * @param farben        Auswahl aus /parts/brick-colors; leer heisst „nur die
 *                      heutige Farbe".
 * @param aktuell       die Rebrickable-Farbnummer, die das Teil heute traegt.
 * @param aktuellerName ihr Name, soweit bekannt — sonst steht die Nummer da.
 * @param onWahl        wird nur gerufen, wenn eine ANDERE Farbe gewaehlt wird.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FarbWahlFeld(
    farben: List<BrickColor>,
    aktuell: Int,
    aktuellerName: String?,
    aktuellerHex: String?,
    onWahl: (BrickColor) -> Unit,
    modifier: Modifier = Modifier,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    // Was die Liste ueber die heutige Farbe weiss, gewinnt gegen die
    // Bestandszeile: Dort steht der Name, der beim Erfassen mitgeschickt wurde,
    // und der kann aelter sein als der Katalog.
    val ausListe = farben.firstOrNull { it.id == aktuell }
    val name = ausListe?.name ?: aktuellerName?.takeIf { it.isNotBlank() }
        ?: stringResource(R.string.parts_color_unknown, aktuell)
    val hex = ausListe?.hex ?: aktuellerHex

    ExposedDropdownMenuBox(
        expanded = offen && farben.isNotEmpty(),
        onExpandedChange = { if (farben.isNotEmpty()) offen = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = {},
            readOnly = true,
            leadingIcon = { FarbPunkt(hex, Modifier.padding(start = Abstaende.mittel)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen) },
            modifier = Modifier.fillMaxWidth()
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = true),
            singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = Schrift.klein),
            shape = Formen.knopf,
        )
        ExposedDropdownMenu(expanded = offen && farben.isNotEmpty(), onDismissRequest = { offen = false }) {
            farben.forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.name) },
                    leadingIcon = { FarbPunkt(c.hex) },
                    onClick = {
                        offen = false
                        // Dieselbe Farbe nochmal ist keine Aenderung — und der
                        // Server wuerde sie auch abweisen. Hier abzubrechen
                        // spart die Anfrage UND das Neuladen des Bildschirms.
                        if (c.id != aktuell) onWahl(c)
                    },
                )
            }
        }
    }
}

/** Der Farbpunkt. Ein unlesbarer Hex-Wert ergibt KEINEN Punkt, keinen falschen. */
@Composable
private fun FarbPunkt(hex: String?, modifier: Modifier = Modifier) {
    val farbe = hex?.let {
        try { Color("#$it".toColorInt()) } catch (_: Exception) { null }
    } ?: return
    Box(modifier.size(14.dp).clip(CircleShape).background(farbe))
}
