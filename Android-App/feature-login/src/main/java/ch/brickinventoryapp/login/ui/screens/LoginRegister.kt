package ch.brickinventoryapp.login.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.*
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.model.util.PASSWORD_MIN_CHARS
import ch.brickinventoryapp.model.util.passwordToShort
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.PasswordKind
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing

@Composable
internal fun RegisterFields(
    running: Boolean, message: String?, error: String?,
    focusMgr: FocusManager,
    namesSideBySide: Boolean,
    onRegister: (String, String, String, String, String) -> Unit,
    onForm: (LoginForm) -> Unit,
) {
    var user   by rememberSaveable { mutableStateOf("") }
    var email    by rememberSaveable { mutableStateOf("") }
    var firstName  by rememberSaveable { mutableStateOf("") }
    var lastName by rememberSaveable { mutableStateOf("") }
    // Passwords only in remember, see above.
    var pw1      by remember { mutableStateOf("") }
    var pw2      by remember { mutableStateOf("") }
    // What goes wrong HERE before anything is even sent. Separate from the
    // server error, otherwise one would overwrite the other.
    var ownError by rememberSaveable { mutableStateOf<String?>(null) }

    val reqFields  = stringResource(R.string.register_req_fields)
    val toShort     = stringResource(R.string.register_password_short)
    val unequal   = stringResource(R.string.register_password_mismatch)

    LoginTitle(stringResource(R.string.register_title))

    // After a successful registration, only the message and the
    // way back are left — the fields would now just be an invitation to
    // create the same account a second time. The web app does the same
    // (hiding `reg-form`, showing `reg-success`).
    if (message != null) {
        FormMessage(message, error = false)
    } else {
        val nextOptions = KeyboardOptions(imeAction = ImeAction.Next)
        val next = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
        OutlinedTextField(
            value = user, onValueChange = { user = it },
            label = { Text(stringResource(R.string.login_username)) },
            leadingIcon = { Icon(Icons.Default.Person, null) },
            modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.NewUsername }, singleLine = true, shape = Shapes.field,
            keyboardOptions = nextOptions, keyboardActions = next)
        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text(stringResource(R.string.register_email)) },
            leadingIcon = { Icon(Icons.Default.Email, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Shapes.field,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next,
                keyboardType = KeyboardType.Email),
            keyboardActions = next)
        NamedFields(firstName, { firstName = it }, lastName, { lastName = it }, namesSideBySide, next)
        // The minimum length is shown from the start, not only as an error after sending.
        PasswordField(pw1, { pw1 = it }, stringResource(R.string.login_password), Modifier.fillMaxWidth(),
            kind = PasswordKind.NEW, hint = pluralStringResource(R.plurals.password_at_least, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS),
            imeAction = ImeAction.Next, keyboardActions = next)
        PasswordField(pw2, { pw2 = it }, stringResource(R.string.register_password_repeat), Modifier.fillMaxWidth(),
            kind = PasswordKind.RETRY)

        val showTo = ownError ?: error
        if (showTo != null) FormMessage(showTo, error = true)

        // The same rule as for sign-in: disabled when empty, what is missing stands above it.
        val complete = user.isNotBlank() && email.isNotBlank() && pw1.isNotBlank()
        LoadButton(stringResource(R.string.register_button), running = running, active = complete, missing = reqFields) {
            // The same checks as in the web form, in the same order; the
            // length limit (PASSWORD_MIN_CHARS) is the server's (`routes/auth.ts`). Anticipated
            // here, so that it needs no round trip over the network.
            ownError = when {
                passwordToShort(pw1) -> toShort
                pw1 != pw2     -> unequal
                else           -> null
            }
            if (ownError == null) onRegister(user, email, firstName, lastName, pw1)
        }
    }

    TextButton(onClick = { onForm(LoginForm.LOGIN) },
        modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.login_back))
    }
}

/**
 * First and last name; in one row on the tablet: six fields stacked
 * pushed „Registrieren“ below the fold.
 */
@Composable
private fun NamedFields(
    firstName: String, onFirstName: (String) -> Unit, lastName: String, onLastName: (String) -> Unit,
    sideBySide: Boolean, next: KeyboardActions,
) {
    val field: @Composable (String, (String) -> Unit, Int, Modifier) -> Unit = { value, onValue, label, width ->
        OutlinedTextField(
            value = value, onValueChange = onValue,
            label = { Text(stringResource(label)) },
            leadingIcon = { Icon(Icons.Default.Badge, null) },
            modifier = width, singleLine = true, shape = Shapes.field,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), keyboardActions = next)
    }
    if (sideBySide) Row(horizontalArrangement = Arrangement.spacedBy(Spacing.medium)) {
        field(firstName, onFirstName, R.string.register_first_name, Modifier.weight(1f))
        field(lastName, onLastName, R.string.register_last_name, Modifier.weight(1f))
    } else {
        field(firstName, onFirstName, R.string.register_first_name, Modifier.fillMaxWidth())
        field(lastName, onLastName, R.string.register_last_name, Modifier.fillMaxWidth())
    }
}
