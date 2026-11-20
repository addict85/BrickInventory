package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import ch.brickinventoryapp.model.util.PASSWORD_MIN_CHARS
import ch.brickinventoryapp.model.util.passwordToShort
import ch.brickinventoryapp.resources.R

/** Ein Feld des Passwortwechsels, das vor dem Absenden nicht stimmt. */
enum class PasswordFieldError { AKTUELL, NEU, WIEDERHOLUNG }

/** Was vor dem Absenden nicht stimmt, in der Reihenfolge der Felder. */
fun passwordSwitchError(aktuell: String, neu: String, wiederholt: String): List<PasswordFieldError> = buildList {
    if (aktuell.isBlank()) add(PasswordFieldError.AKTUELL)
    if (passwordToShort(neu)) add(PasswordFieldError.NEU)
    if (wiederholt != neu) add(PasswordFieldError.WIEDERHOLUNG)
}

/**
 * Der Zustand des Absendens: Der Knopf bleibt antippbar und markiert dann jedes falsche
 * Feld, der Cursor geht ins erste davon (wie beim Set-Dialog). Ein gesperrter Knopf liess
 * raten, was fehlt.
 */
class PasswordSwitchCheck {
    var geprueft by mutableStateOf(false)
        private set
    internal val fokus = PasswordFieldError.entries.associateWith { FocusRequester() }

    fun submit(aktuell: String, neu: String, wiederholt: String, weiter: () -> Unit) {
        geprueft = true
        val erstes = passwordSwitchError(aktuell, neu, wiederholt).firstOrNull() ?: return weiter()
        try { fokus.getValue(erstes).requestFocus() } catch (_: IllegalStateException) { /* nicht angeordnet */ }
    }

    fun reset() { geprueft = false }
}

@Composable
fun rememberPasswordSwitchCheck(): PasswordSwitchCheck = remember { PasswordSwitchCheck() }

/** Aktuelles, neues und wiederholtes Passwort, mit den Fehlern aus [check]. */
@Composable
fun PasswordSwitchFields(
    aktuell: String,
    onCurrent: (String) -> Unit,
    neu: String,
    onNew: (String) -> Unit,
    wiederholt: String,
    onRepeated: (String) -> Unit,
    check: PasswordSwitchCheck,
    weiter: KeyboardActions = KeyboardActions.Default,
) {
    val fehler = if (check.geprueft) passwordSwitchError(aktuell, neu, wiederholt) else emptyList()
    val currentMissing = PasswordFieldError.AKTUELL in fehler
    // Zu kurz und verschieden zeigen sich schon beim Tippen, leer erst nach dem Absenden.
    val newWrong = PasswordFieldError.NEU in fehler || (neu.isNotEmpty() && passwordToShort(neu))
    val verschieden = PasswordFieldError.WIEDERHOLUNG in fehler || (wiederholt.isNotEmpty() && wiederholt != neu)
    PasswordField(aktuell, onCurrent, stringResource(R.string.konto_password_current),
        Modifier.fillMaxWidth().focusRequester(check.fokus.getValue(PasswordFieldError.AKTUELL)),
        hinweis = if (currentMissing) stringResource(R.string.login_password_fehlt) else null,
        faulty = currentMissing, imeAction = ImeAction.Next, keyboardActions = weiter)
    PasswordField(neu, onNew, stringResource(R.string.konto_password_new),
        Modifier.fillMaxWidth().focusRequester(check.fokus.getValue(PasswordFieldError.NEU)),
        art = PasswordKind.NEU,
        hinweis = if (newWrong) stringResource(R.string.register_password_short)
                  else pluralStringResource(R.plurals.passwort_mindestens, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS),
        faulty = newWrong, imeAction = ImeAction.Next, keyboardActions = weiter)
    PasswordField(wiederholt, onRepeated, stringResource(R.string.register_password_repeat),
        Modifier.fillMaxWidth().focusRequester(check.fokus.getValue(PasswordFieldError.WIEDERHOLUNG)),
        art = PasswordKind.WIEDERHOLUNG,
        hinweis = if (verschieden) stringResource(R.string.startpasswort_verschieden) else null,
        faulty = verschieden)
}
