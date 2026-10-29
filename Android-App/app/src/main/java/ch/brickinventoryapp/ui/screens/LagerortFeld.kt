package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Das Lagerort-Feld: auswählen oder neu eintippen, in einem Bedienelement — ein
 * ExposedDropdownMenuBox klappt auf wie ein Auswahlfeld und nimmt trotzdem
 * Getipptes an, das Gegenstück zur `datalist` der Webapp.
 *
 * Getipptes speichert entprellt, nicht beim Fokusverlust: Am Telefon tippt man,
 * schliesst die Tastatur und geht zurück — dieser Fokuswechsel kommt nie. Die
 * Ruhezeit liegt im ViewModel und überlebt den Bildschirm (siehe
 * setzeSetLagerort). Eine Wahl aus der Liste speichert sofort: Sie ist fertig,
 * wenn sie getroffen wird.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LagerortFeld(
    wert: String,
    vorrat: List<String>,
    onWert: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Schluessel ist der Wert von aussen: Kommt ein anderer (anderes Set, oder
    // der normalisierte Wert nach dem Speichern), soll das Feld ihn zeigen
    // statt den alten Text zu behalten.
    var text by rememberSaveable(wert) { mutableStateOf(wert) }
    // rememberSaveable, nicht remember (BildschirmZustandTest): Wer beim Wählen eines
    // Orts das Telefon dreht, soll die Liste weiter offen sehen. Dass sie nur
    // erscheint, wenn es passende Orte gibt, macht es unschädlich.
    var offen by rememberSaveable { mutableStateOf(false) }
    // Was zur Auswahl steht, waehrend getippt wird: nur die passenden. Bei
    // dreissig Regalen ist eine ungefilterte Liste keine Hilfe mehr.
    val passend = vorrat.filter { it.contains(text.trim(), ignoreCase = true) }

    ExposedDropdownMenuBox(
        expanded = offen && passend.isNotEmpty(),
        onExpandedChange = { offen = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = {
                if (it.length <= 60) { text = it; offen = true; onWert(it) }
            },
            singleLine = true,
            placeholder = { Text(stringResource(R.string.detail_storage_ph), style = MaterialTheme.typography.bodySmall) },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen)
            },
            modifier = Modifier.menuAnchor(
                ExposedDropdownMenuAnchorType.PrimaryEditable, true),
        )
        ExposedDropdownMenu(
            expanded = offen && passend.isNotEmpty(),
            onDismissRequest = { offen = false },
        ) {
            for (ort in passend) {
                DropdownMenuItem(
                    text = { Text(ort, style = MaterialTheme.typography.labelLarge) },
                    onClick = { text = ort; offen = false; onWert(ort) },
                )
            }
        }
    }
}

/**
 * Dasselbe Feld im Erfassen-Dialog: mit Beschriftung und voller Breite, damit sich
 * der Lagerort schon beim Erfassen setzen lässt — in Galerie, Barcode, Katalog,
 * Merkliste und bei manuellen Teilen und Figuren. Eine eigene Fassung, weil das
 * Feld in den Detailansichten schmal neben seiner Beschriftung steht, im Dialog
 * darunter über die ganze Breite wie die Felder darüber. Das Bedienelement selbst
 * bleibt dasselbe.
 */
@Composable
fun LagerortErfassung(
    wert: String,
    vorrat: List<String>,
    onWert: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
        Text(stringResource(R.string.detail_storage),
             style = MaterialTheme.typography.labelLarge)
        LagerortFeld(wert = wert, vorrat = vorrat, onWert = onWert,
                     modifier = Modifier.fillMaxWidth())
    }
}
