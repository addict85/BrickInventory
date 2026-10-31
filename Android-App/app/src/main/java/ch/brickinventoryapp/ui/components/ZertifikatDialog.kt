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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.ZertifikatUngeklaert
import ch.brickinventoryapp.util.fingerabdruckLesbar

/**
 * Die Frage nach einem Zertifikat, das die App nicht von selbst annimmt. Der
 * Fingerabdruck steht in Vierergruppen da, damit man ihn mit der Anzeige des
 * Servers vergleichen kann; ein geänderter Schlüssel nennt beide.
 */
@Composable
fun ZertifikatDialog(
    frage: ZertifikatUngeklaert,
    nutzerCaAn: Boolean,
    onVertrauen: () -> Unit,
    onNutzerCa: () -> Unit,
    onAbbrechen: () -> Unit,
) {
    val host = frage.schluessel.substringBeforeLast(':')
    val (titel, text) = when (frage.art) {
        ZertifikatUngeklaert.Art.ERSTKONTAKT -> R.string.zert_titel_erstkontakt to R.string.zert_text_erstkontakt
        ZertifikatUngeklaert.Art.UNBEKANNTE_CA -> R.string.zert_titel_unbekannt to R.string.zert_text_unbekannt
        ZertifikatUngeklaert.Art.GEAENDERT -> R.string.zert_titel_geaendert to R.string.zert_text_geaendert
    }
    val geaendert = frage.art == ZertifikatUngeklaert.Art.GEAENDERT
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(stringResource(titel), modifier = Modifier.semantics { heading() }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(stringResource(text, host))
                Text(stringResource(R.string.zert_fingerabdruck), style = MaterialTheme.typography.labelMedium)
                Text(fingerabdruckLesbar(frage.fingerabdruck), fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall)
                frage.erwartet?.let {
                    Text(stringResource(R.string.zert_bisher), style = MaterialTheme.typography.labelMedium)
                    Text(fingerabdruckLesbar(it), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                // Die einzige Stelle, an der nach Nutzer-CAs gefragt wird: beim Fehler,
                // mit Erklärung. Den Fingerabdruck bestätigt man danach trotzdem einmal.
                if (frage.art == ZertifikatUngeklaert.Art.UNBEKANNTE_CA && !nutzerCaAn) {
                    TextButton(onClick = onNutzerCa) { Text(stringResource(R.string.zert_nutzer_ca)) }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onVertrauen,
                colors = if (geaendert) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                         else ButtonDefaults.textButtonColors(),
            ) { Text(stringResource(if (geaendert) R.string.zert_vertrauen_neu else R.string.zert_vertrauen)) }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
}
