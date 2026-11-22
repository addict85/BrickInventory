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

/** A field of the password change that isn't valid before submitting. */
enum class PasswordFieldError { CURRENT, NEW, RETRY }

/** What isn't valid before submitting, in the order of the fields. */
fun passwordSwitchError(current: String, newValue: String, retried: String): List<PasswordFieldError> = buildList {
    if (current.isBlank()) add(PasswordFieldError.CURRENT)
    if (passwordToShort(newValue)) add(PasswordFieldError.NEW)
    if (retried != newValue) add(PasswordFieldError.RETRY)
}

/**
 * The state of submitting: the button stays tappable and then marks every wrong
 * field, the cursor goes into the first of them (as in the set dialog). A locked button left
 * you guessing what's missing.
 */
class PasswordSwitchCheck {
    var checked by mutableStateOf(false)
        private set
    internal val focus = PasswordFieldError.entries.associateWith { FocusRequester() }

    fun submit(current: String, newValue: String, retried: String, next: () -> Unit) {
        checked = true
        val first = passwordSwitchError(current, newValue, retried).firstOrNull() ?: return next()
        try { focus.getValue(first).requestFocus() } catch (_: IllegalStateException) { /* not arranged */ }
    }

    fun reset() { checked = false }
}

@Composable
fun rememberPasswordSwitchCheck(): PasswordSwitchCheck = remember { PasswordSwitchCheck() }

/** Current, new and repeated password, with the errors from [check]. */
@Composable
fun PasswordSwitchFields(
    current: String,
    onCurrent: (String) -> Unit,
    newValue: String,
    onNew: (String) -> Unit,
    retried: String,
    onRepeated: (String) -> Unit,
    check: PasswordSwitchCheck,
    next: KeyboardActions = KeyboardActions.Default,
) {
    val error = if (check.checked) passwordSwitchError(current, newValue, retried) else emptyList()
    val currentMissing = PasswordFieldError.CURRENT in error
    // Too short and different show up while typing already, empty only after submitting.
    val newWrong = PasswordFieldError.NEW in error || (newValue.isNotEmpty() && passwordToShort(newValue))
    val different = PasswordFieldError.RETRY in error || (retried.isNotEmpty() && retried != newValue)
    PasswordField(current, onCurrent, stringResource(R.string.account_password_current),
        Modifier.fillMaxWidth().focusRequester(check.focus.getValue(PasswordFieldError.CURRENT)),
        hint = if (currentMissing) stringResource(R.string.login_password_missing) else null,
        faulty = currentMissing, imeAction = ImeAction.Next, keyboardActions = next)
    PasswordField(newValue, onNew, stringResource(R.string.account_password_new),
        Modifier.fillMaxWidth().focusRequester(check.focus.getValue(PasswordFieldError.NEW)),
        kind = PasswordKind.NEW,
        hint = if (newWrong) stringResource(R.string.register_password_short)
                  else pluralStringResource(R.plurals.password_at_least, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS),
        faulty = newWrong, imeAction = ImeAction.Next, keyboardActions = next)
    PasswordField(retried, onRepeated, stringResource(R.string.register_password_repeat),
        Modifier.fillMaxWidth().focusRequester(check.focus.getValue(PasswordFieldError.RETRY)),
        kind = PasswordKind.RETRY,
        hint = if (different) stringResource(R.string.start_password_different) else null,
        faulty = different)
}
