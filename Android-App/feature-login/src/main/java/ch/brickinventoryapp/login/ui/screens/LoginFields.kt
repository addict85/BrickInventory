package ch.brickinventoryapp.login.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LoginFields(
    username: String, onUsername: (String) -> Unit,
    password: String, onPassword: (String) -> Unit,
    codeNeeded: Boolean, code: String, onCode: (String) -> Unit,
    isLoading: Boolean, error: String?,
    registrationOpen: Boolean?,
    focusMgr: FocusManager,
    onLogin: (String, String, String?) -> Unit,
    onForm: (LoginForm) -> Unit,
    fullAccess: Boolean,
    onFullAccess: (Boolean) -> Unit,
    onPasskey: (() -> Unit)?,
    onPasskeyInsteadOfCode: ((String, String) -> Unit)?,
) {
    LoginTitle(stringResource(R.string.login_title))
    // The button stays tappable; a tap with empty fields shows at the field what is missing.
    // Disabled and pale, it left one guessing why nothing happens.
    var tried by rememberSaveable { mutableStateOf(false) }
    val nameMissing = tried && username.isBlank()
    val passwordMissing = tried && password.isBlank()
    val codeMissing = tried && codeNeeded && code.isBlank()
    val logIn = {
        tried = true
        if (username.isNotBlank() && password.isNotBlank() && (!codeNeeded || code.isNotBlank()))
            onLogin(username, password, code.takeIf { codeNeeded })
    }

    OutlinedTextField(
        value = username, onValueChange = onUsername,
        label = { Text(stringResource(R.string.login_username)) },
        isError = nameMissing,
        supportingText = if (nameMissing) ({ Text(stringResource(R.string.login_username_missing)) }) else null,
        leadingIcon = { Icon(Icons.Default.Person, null) },
        // For the password manager: it only fills what it recognizes as a sign-in field.
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username }, singleLine = true,
        shape = Shapes.field,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
    )

    PasswordField(
        value = password, onValue = onPassword,
        label = stringResource(R.string.login_password),
        modifier = Modifier.fillMaxWidth(),
        hint = if (passwordMissing) stringResource(R.string.login_password_missing) else null,
        faulty = passwordMissing,
        imeAction = if (codeNeeded) ImeAction.Next else ImeAction.Done,
        keyboardActions = KeyboardActions(
            onNext = { focusMgr.moveFocus(FocusDirection.Down) },
            onDone = {
                focusMgr.clearFocus()
                logIn()
            }),
    )

    // Only visible once the server demands the second factor.
    // Text instead of number: a recovery code (letters) fits in it too.
    if (codeNeeded) {
        OutlinedTextField(
            value = code, onValueChange = { onCode(it.take(24)) },
            label = { Text(stringResource(R.string.login_code)) },
            isError = codeMissing,
            supportingText = { Text(stringResource(if (codeMissing) R.string.login_code_missing else R.string.login_code_hint)) },
            leadingIcon = { Icon(Icons.Default.Key, null) },
            // No SmsOtpCode: the code comes from an authenticator app, not by SMS, and
            // Compose has no autofill type for TOTP. The system otherwise offered SMS codes.
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Shapes.field,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Ascii),
            keyboardActions = KeyboardActions(onDone = { focusMgr.clearFocus(); logIn() })
        )
    }

    if (error != null) FormMessage(error, error = true)

    // Without the checkbox, a token without admin rights, even for an admin account. Checking the
    // box asks for the device lock: a token with scope "voll" can do anything.
    // Collapsed under „Erweitert“: hardly anyone needs it to collect, and open
    // it pushed the sign-in button out of the first frame at 200 %.
    val protection = LocalStepGuard.current
    val fullReason = stringResource(R.string.step_full_access)
    var extended by rememberSaveable { mutableStateOf(fullAccess) }
    // The state for TalkBack: whether the section is open was otherwise only visible.
    val condition = stringResource(if (extended) R.string.state_expanded else R.string.state_collapsed)
    TextButton(onClick = { extended = !extended }, modifier = Modifier.semantics {
        stateDescription = condition
        if (extended) collapse { extended = false; true } else expand { extended = true; true }
    }) {
        Text(stringResource(R.string.login_extended))
        Icon(if (extended) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
    }
    // Flush at the top: the checkbox belongs to the first line, not the middle of the block
    // (three lines at large font).
    if (extended) Row(verticalAlignment = Alignment.Top,
        modifier = Modifier.fillMaxWidth().toggleable(value = fullAccess, role = Role.Checkbox,
            onValueChange = { an -> if (an) protection.confirm(fullReason) { onFullAccess(true) } else onFullAccess(false) })) {
        Checkbox(checked = fullAccess, onCheckedChange = null)
        Column(Modifier.padding(start = Spacing.small, top = Spacing.hairline)) {
            Text(stringResource(R.string.login_full_access), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.login_full_access_hint), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    LoadButton(stringResource(R.string.login_button), running = isLoading, active = true, onClick = logIn)

    // Instead of the code: name and password from above go along, the passkey only replaces the code.
    if (codeNeeded && onPasskeyInsteadOfCode != null) {
        OutlinedButton(onClick = { onPasskeyInsteadOfCode(username, password) },
            enabled = !isLoading && username.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = secondaryButtonColors(),
            border = secondaryButtonRand(!isLoading && username.isNotBlank() && password.isNotBlank())) {
            Icon(Icons.Default.Fingerprint, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.login_passkey_instead_of_code))
        }
    } else if (!codeNeeded && onPasskey != null) {
        OutlinedButton(onClick = onPasskey, enabled = !isLoading,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = secondaryButtonColors(),
            border = secondaryButtonRand(!isLoading)) {
            Icon(Icons.Default.Fingerprint, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.login_passkey))
        }
    }

    // The register link appears ONLY on an explicit `true`.
    // `null` means "not asked yet" or "the server did not
    // answer" — in both cases the button led nowhere.
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        if (registrationOpen == true) {
            TextButton(onClick = { onForm(LoginForm.REGISTER) }) {
                Text(stringResource(R.string.login_no_account), textAlign = TextAlign.Center)
            }
        }
        TextButton(onClick = { onForm(LoginForm.FORGOT_PASSWORD) }) {
            Text(stringResource(R.string.login_forgot), textAlign = TextAlign.Center)
        }
    }
}

@Composable
internal fun ForgotPasswordFields(
    running: Boolean, message: String?, error: String?,
    sendOn: (String) -> Unit,
    onForm: (LoginForm) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var ownError by rememberSaveable { mutableStateOf<String?>(null) }
    val needsEmail = stringResource(R.string.forgot_email_required)

    LoginTitle(stringResource(R.string.forgot_title))

    if (message != null) {
        FormMessage(message, error = false)
    } else {
        // Says WHERE the link leads. It carries the token in the address and
        // opens the server's web UI — the app cannot intercept
        // it, because everyone sets the server address themselves and it therefore
        // cannot appear in any intent filter.
        Text(stringResource(R.string.forgot_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Start)
        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text(stringResource(R.string.register_email)) },
            leadingIcon = { Icon(Icons.Default.Email, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Shapes.field,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done,
                keyboardType = KeyboardType.Email))

        val showTo = ownError ?: error
        if (showTo != null) FormMessage(showTo, error = true)

        LoadButton(stringResource(R.string.forgot_button), running = running, active = true) {
            ownError = if (email.isBlank()) needsEmail else null
            if (ownError == null) sendOn(email)
        }
    }

    TextButton(onClick = { onForm(LoginForm.LOGIN) },
        modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.login_back))
    }
}
