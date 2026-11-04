package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.text.style.TextOverflow
import ch.brickinventoryapp.ressourcen.R

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
    /**
     * Was im leeren Feld steht. In den Detailansichten „Kein Lagerort“ — ein Beispiel
     * wie „z. B. Kiste 3“ im Auswahlrahmen las sich dort wie ein gesetzter Ort; das
     * Beispiel steht nur beim Erfassen (LagerortErfassung).
     */
    platzhalter: String = stringResource(R.string.detail_storage_none),
    /** Beschriftung im Feld; mit ihr steht das Beispiel als Hilfetext darunter statt als Platzhalter. */
    beschriftung: String? = null,
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
            shape = ch.brickinventoryapp.ui.theme.Formen.feld,
            value = text,
            onValueChange = {
                if (it.length <= 60) { text = it; offen = true; onWert(it) }
            },
            singleLine = true,
            label = beschriftung?.let { { Text(it) } },
            placeholder = if (beschriftung == null) {
                // Feldschrift wie jedes Eingabefeld: Kleiner als die Beschriftung daneben sah
                // „Kein Lagerort“ wie eine Fussnote aus.
                { Text(platzhalter, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            } else null,
            supportingText = beschriftung?.let { { Text(platzhalter) } },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen)
            },
            // So breit, wie der Aufrufer es vorgibt: Ohne Breite blieb das Feld bei Materials
            // 280 dp stehen — im Dialog schmaler als die anderen, im Detail halb so breit.
            modifier = Modifier.menuAnchor(
                ExposedDropdownMenuAnchorType.PrimaryEditable, true)
                .fillMaxWidth(),
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
 * Dasselbe Feld im Erfassen-Dialog: Beschriftung im Feld und volle Breite wie die
 * Felder darüber, damit sich der Lagerort schon beim Erfassen setzen lässt — in
 * Galerie, Barcode, Katalog, Merkliste und bei manuellen Teilen und Figuren. In den
 * Detailansichten steht das Feld schmal neben seiner Beschriftung.
 */
@Composable
fun LagerortErfassung(
    wert: String,
    vorrat: List<String>,
    onWert: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Gibt es schon Orte, ist das Feld eine Auswahl; ein Beispiel wie „Kiste 3“
    // passte dort nicht zur Liste, die aufklappt.
    val hilfe = if (vorrat.isNotEmpty()) R.string.detail_storage_choose else R.string.detail_storage_ph
    LagerortFeld(wert = wert, vorrat = vorrat, onWert = onWert,
                 modifier = modifier.fillMaxWidth(), platzhalter = stringResource(hilfe),
                 beschriftung = stringResource(R.string.detail_storage))
}
