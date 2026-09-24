package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
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
    // rememberSaveable, nicht remember: BildschirmZustandTest hat genau das
    // gemeldet, und mit Recht. Wer gerade dabei ist, einen Ort zu waehlen,
    // und dabei das Telefon dreht, soll die Liste weiter offen sehen statt
    // von vorn anfangen zu muessen. Dass sie zwei Zeilen tiefer ohnehin nur
    // erscheint, wenn es passende Orte gibt, macht es unschaedlich.
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

/**
 * Dasselbe Feld, aber im ERFASSEN-Dialog: mit Beschriftung und voller Breite.
 *
 * ── Marcos Befund vom 24.09. ────────────────────────────────────────────────
 *
 * Der Lagerort liess sich erst NACH dem Erfassen setzen — im Detaildialog.
 * „Wenn ich ein Set in der Galerie hinzufuegen will, kann ich den Lagerort
 * nicht waehlen. Egal ob ich das manuell oder per Barcode hinzufuege." Dazu
 * die Wege aus Katalog und Merkliste sowie die manuellen Teile und Figuren.
 *
 * ── Warum eine eigene Fassung und nicht fuenfmal [LagerortFeld] ─────────────
 *
 * In den Detailansichten steht das Feld in einer Zeile NEBEN seiner
 * Beschriftung und ist schmal. In einem Dialog steht es unter ihr und nimmt
 * die ganze Breite — wie die Felder darueber. Diese eine Stelle haelt den
 * Unterschied fest; das Bedienelement selbst bleibt dasselbe.
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
