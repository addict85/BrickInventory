package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
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
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.ui.farbName
import ch.brickinventoryapp.ui.ohneKeineFarbe
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Die Farbe eines manuell erfassten Teils auswählen — zum Korrigieren, wenn sie
 * beim Import nicht richtig übernommen wurde.
 *
 * Nicht die Auswahl aus AddPartDialog: Die hält selbst ein `BrickColor?` („noch
 * nichts gewählt“ = null). Hier hat das Teil eine Farbe, sie ist nur falsch; die
 * aktuelle kommt deshalb von aussen und muss auch anzeigbar sein, wenn die Liste
 * sie nicht kennt. Dafür [aktuellerName] und [aktuellerHex]: Die Farbliste kommt
 * über das Netz und kann leer sein (kein Rebrickable-Schlüssel, kein Netz) — dann
 * steht die heutige Farbe da und die Liste bleibt zu.
 *
 * Eine Wahl speichert sofort, ohne Ruhezeit — wie die Ortswahl in [LagerortFeld].
 *
 * @param farben        Auswahl aus /parts/brick-colors; leer heisst „nur die
 *         heutige Farbe“.
 * @param aktuell       die Rebrickable-Farbnummer, die das Teil heute trägt.
 * @param aktuellerName ihr Name, soweit bekannt — sonst steht die Nummer da.
 * @param onWahl        wird nur gerufen, wenn eine andere Farbe gewählt wird.
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
    val keineFarbe = stringResource(R.string.parts_no_color)
    val name = farbName(farben, aktuell, aktuellerName, keineFarbe)
        ?: stringResource(R.string.parts_color_unknown, aktuell)
    val hex = if (aktuell == KEINE_FARBE) null else farben.firstOrNull { it.id == aktuell }?.hex ?: aktuellerHex
    // „Keine Farbe“ steht zur Wahl, damit sich eine falsch übernommene Farbe auch entfernen lässt.
    val wahl = listOf(BrickColor(KEINE_FARBE, keineFarbe)) + ohneKeineFarbe(farben)

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
            textStyle = MaterialTheme.typography.bodySmall,
            shape = Formen.knopf,
        )
        ExposedDropdownMenu(expanded = offen && farben.isNotEmpty(), onDismissRequest = { offen = false }) {
            wahl.forEach { c ->
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
