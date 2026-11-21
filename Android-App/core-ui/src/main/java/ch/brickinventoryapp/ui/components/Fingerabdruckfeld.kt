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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * The field for typing in a fingerprint, the same for the certificate question and the QR code. It
 * inserts the colons itself and only counts hex characters ([pairTranscriptIn]); [fehler]
 * gets the counted characters, so it can say how many are missing for „too short“.
 */
@Composable
fun Fingerabdruckfeld(
    eingabe: String,
    onInput: (String) -> Unit,
    noetig: Int,
    help: String,
    fehler: @Composable (gezaehlt: Int) -> String?,
    modifier: Modifier = Modifier,
) {
    var cursor by rememberSaveable { mutableIntStateOf(eingabe.length) }
    val gezaehlt = transcriptChars(eingabe)
    val errorText = fehler(gezaehlt)
    OutlinedTextField(
        shape = Formen.feld,
        value = TextFieldValue(eingabe, TextRange(cursor)),
        onValueChange = { neu ->
            val (text, place) = pairTranscriptIn(neu.text, neu.selection.end)
            cursor = place
            onInput(text)
        },
        // Short label, the instructions below it: a sentence as a label used to get
        // cut off and sat above the field while typing.
        label = { Text(stringResource(R.string.zert_eingabe_etikett)) },
        isError = errorText != null,
        supportingText = {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(errorText ?: help, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.zert_eingabe_zaehler, gezaehlt, noetig))
            }
        },
        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
        modifier = modifier.fillMaxWidth(),
    )
}
