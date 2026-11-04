package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Ein Text, der nach einer Handlung erscheint, wird angesagt: Ohne Live-Region hört
 * eine blinde Person nach „Anmelden“ nichts und weiss nicht, dass es scheiterte.
 */
fun Modifier.ansagen(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

/** Eine Fehlerzeile unter einem Formular, in Fehlerfarbe und angesagt. */
@Composable
fun FehlerZeile(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.ansagen(), color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium)
}

/** Was ins Feld gehört — davon hängt ab, was der Passwortmanager anbietet. */
enum class PasswortArt {
    /** Das bestehende Passwort: Der Manager setzt es ein. */
    AKTUELL,
    /** Ein neues Passwort: Der Manager schlägt ein starkes vor und merkt es sich. */
    NEU,
    /** Die Wiederholung des neuen. */
    WIEDERHOLUNG,
}

/**
 * Jedes Passwortfeld der App: mit Autofill-Art, Passworttastatur und dem Auge zum
 * Aufdecken. Solange das Passwort sichtbar ist, gilt der Sichtschutz — ein
 * aufgedecktes Passwort gehört in kein Bildschirmfoto, egal auf welcher Seite.
 */
@Composable
fun PasswortFeld(
    wert: String,
    onWert: (String) -> Unit,
    beschriftung: String,
    modifier: Modifier = Modifier,
    art: PasswortArt = PasswortArt.AKTUELL,
    /** Hilfe- oder Fehlertext unter dem Feld; mit [fehlerhaft] in Fehlerfarbe. */
    hinweis: String? = null,
    fehlerhaft: Boolean = false,
    imeAction: ImeAction = ImeAction.Done,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    var sichtbar by rememberSaveable { mutableStateOf(false) }
    if (sichtbar) Sichtschutz()
    val autofill = if (art == PasswortArt.AKTUELL) ContentType.Password else ContentType.NewPassword
    OutlinedTextField(
        value = wert,
        onValueChange = onWert,
        label = { Text(beschriftung) },
        // Das Schloss überall, nicht nur in der Anmeldung: So erkennt man ein Passwortfeld
        // auf jeder Seite gleich.
        leadingIcon = { Icon(Icons.Default.Lock, null) },
        trailingIcon = {
            IconButton(onClick = { sichtbar = !sichtbar }) {
                Icon(
                    if (sichtbar) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                    stringResource(if (sichtbar) R.string.cd_password_hide else R.string.cd_password_show),
                )
            }
        },
        visualTransformation = if (sichtbar) VisualTransformation.None else PasswordVisualTransformation(),
        isError = fehlerhaft,
        supportingText = hinweis?.let { { Text(it) } },
        singleLine = true,
        shape = Formen.feld,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction),
        keyboardActions = keyboardActions,
        modifier = modifier.semantics { contentType = autofill },
    )
}
