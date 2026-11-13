package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Das Feld zum Abtippen eines Fingerabdrucks, für Zertifikatsfrage und QR-Code gleich. Es
 * setzt die Doppelpunkte selbst und zählt nur Hex-Zeichen ([abschriftInPaaren]); [fehler]
 * bekommt die gezählten Zeichen, damit „zu kurz“ sagen kann, wie viele fehlen.
 */
@Composable
fun Fingerabdruckfeld(
    eingabe: String,
    onEingabe: (String) -> Unit,
    noetig: Int,
    hilfe: String,
    fehler: @Composable (gezaehlt: Int) -> String?,
    modifier: Modifier = Modifier,
) {
    var cursor by rememberSaveable { mutableIntStateOf(eingabe.length) }
    val gezaehlt = abschriftZeichen(eingabe)
    val fehlerText = fehler(gezaehlt)
    OutlinedTextField(
        shape = Formen.feld,
        value = TextFieldValue(eingabe, TextRange(cursor)),
        onValueChange = { neu ->
            val (text, stelle) = abschriftInPaaren(neu.text, neu.selection.end)
            cursor = stelle
            onEingabe(text)
        },
        // Kurzes Etikett, die Anleitung darunter: Ein Satz als Etikett wurde
        // abgeschnitten und stand beim Tippen über dem Feld.
        label = { Text(stringResource(R.string.zert_eingabe_etikett)) },
        isError = fehlerText != null,
        supportingText = {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(fehlerText ?: hilfe, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.zert_eingabe_zaehler, gezaehlt, noetig))
            }
        },
        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
        modifier = modifier.fillMaxWidth(),
    )
}
