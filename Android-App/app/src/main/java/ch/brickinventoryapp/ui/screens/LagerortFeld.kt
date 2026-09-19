package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Schrift

/**
 * Das Lagerort-Feld: auswaehlen ODER neu eintippen.
 *
 * ── Warum beides in EINEM Bedienelement ─────────────────────────────────────
 *
 * Marco will beides: „ein Dropdown, bei dem man auch gleich neue Auswahlwerte
 * erfassen kann". Ein reines Auswahlfeld kann nur das erste, ein reines
 * Textfeld nur das zweite. Ein ExposedDropdownMenuBox klappt auf wie ein
 * Auswahlfeld und nimmt trotzdem Getipptes an — das Gegenstueck zur
 * `datalist` der Webapp.
 *
 * ── Warum das Tippen ENTPRELLT speichert ────────────────────────────────────
 *
 * Hier stand vorher „nur beim Verlieren des Fokus speichern". Genau das war
 * Marcos Befund beim Preisalarm: Am Telefon tippt man, schliesst die Tastatur
 * und geht zurueck — dieser Fokuswechsel kommt nie. Fuer den Lagerort galt
 * dasselbe, es hat nur noch niemand gemeldet. Die Ruhezeit liegt im
 * ViewModel und ueberlebt den Bildschirm (siehe setzeSetLagerort).
 *
 * Eine Wahl aus der Liste speichert dagegen SOFORT: Sie ist fertig in dem
 * Moment, in dem sie getroffen wird — auf eine Ruhezeit zu warten waere nur
 * eine Verzoegerung ohne Gewinn.
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
    var offen by remember { mutableStateOf(false) }
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
            placeholder = { Text(stringResource(R.string.detail_storage_ph), fontSize = Schrift.klein) },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen)
            },
            modifier = Modifier.menuAnchor(
                MenuAnchorType.PrimaryEditable, true),
        )
        ExposedDropdownMenu(
            expanded = offen && passend.isNotEmpty(),
            onDismissRequest = { offen = false },
        ) {
            for (ort in passend) {
                DropdownMenuItem(
                    text = { Text(ort, fontSize = Schrift.normal) },
                    onClick = { text = ort; offen = false; onWert(ort) },
                )
            }
        }
    }
}
