package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.ZertifikatUngeklaert
import ch.brickinventoryapp.util.fingerabdruckAnfang
import ch.brickinventoryapp.util.fingerabdruckLesbar
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Die Frage nach einem Zertifikat, das die App nicht von selbst annimmt. Der Fingerabdruck
 * steht in derselben Schreibweise da wie in der Webapp, damit man ihn vergleichen kann.
 * Ausführlich: docs/begruendungen/app/ui/components/ZertifikatDialog.kt.md#zertifikatdialog
 */
@Composable
fun ZertifikatDialog(
    frage: ZertifikatUngeklaert,
    nutzerCaAn: Boolean,
    onVertrauen: (eingabe: String?) -> Boolean,
    onNutzerCa: () -> Unit,
    onAbbrechen: () -> Unit,
) {
    var eingabe by rememberSaveable(frage.fingerabdruck) { mutableStateOf("") }
    var falsch by remember(frage.fingerabdruck) { mutableStateOf(false) }
    val host = frage.schluessel.substringBeforeLast(':')
    val (titel, text) = titelUndText(frage.art)
    val geaendert = frage.art == ZertifikatUngeklaert.Art.GEAENDERT
    val abschreiben = frage.art != ZertifikatUngeklaert.Art.ERSTKONTAKT
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(stringResource(titel), modifier = Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(stringResource(text, host))
                frage.erwartet?.let {
                    Text(stringResource(R.string.zert_bisher), style = MaterialTheme.typography.labelMedium)
                    Text(fingerabdruckLesbar(it), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                // Was abzutippen ist, steht nicht da: Sonst schriebe man es vom Bildschirm
                // eines Angreifers ab statt aus der Webapp. Der Anfang zeigt nur, welche Zeile.
                Text(stringResource(if (abschreiben) R.string.zert_beginnt_mit else R.string.zert_fingerabdruck),
                    style = MaterialTheme.typography.labelMedium)
                Text(if (abschreiben) fingerabdruckAnfang(frage.fingerabdruck) else fingerabdruckLesbar(frage.fingerabdruck),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (geaendert) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                if (abschreiben) {
                    OutlinedTextField(
                        shape = Formen.feld,
                        value = eingabe,
                        onValueChange = { eingabe = it; falsch = false },
                        label = { Text(stringResource(if (geaendert) R.string.zert_geaendert_eingabe else R.string.zert_unbekannt_eingabe)) },
                        isError = falsch,
                        supportingText = if (falsch) { { Text(stringResource(R.string.zert_eingabe_falsch)) } } else null,
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(stringResource(R.string.zert_geaendert_qr), style = MaterialTheme.typography.bodySmall)
                }
                // Die einzige Stelle, an der nach Nutzer-CAs gefragt wird: beim Fehler,
                // mit Erklärung. Danach fragt der Dialog erneut (NUTZER_CA), wieder zum Abtippen.
                if (frage.art == ZertifikatUngeklaert.Art.UNBEKANNTE_CA && !nutzerCaAn) {
                    TextButton(onClick = onNutzerCa) { Text(stringResource(R.string.zert_nutzer_ca)) }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { falsch = !onVertrauen(eingabe.takeIf { abschreiben }) },
                enabled = !abschreiben || eingabe.isNotBlank(),
                colors = if (geaendert) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                         else ButtonDefaults.textButtonColors(),
            ) { Text(stringResource(if (geaendert) R.string.zert_vertrauen_neu else R.string.zert_vertrauen)) }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/** Überschrift und Erklärung je Art der Frage. */
private fun titelUndText(art: ZertifikatUngeklaert.Art): Pair<Int, Int> = when (art) {
    ZertifikatUngeklaert.Art.ERSTKONTAKT -> R.string.zert_titel_erstkontakt to R.string.zert_text_erstkontakt
    ZertifikatUngeklaert.Art.UNBEKANNTE_CA -> R.string.zert_titel_unbekannt to R.string.zert_text_unbekannt
    ZertifikatUngeklaert.Art.NUTZER_CA -> R.string.zert_titel_nutzer_ca to R.string.zert_text_nutzer_ca
    ZertifikatUngeklaert.Art.GEAENDERT -> R.string.zert_titel_geaendert to R.string.zert_text_geaendert
}
