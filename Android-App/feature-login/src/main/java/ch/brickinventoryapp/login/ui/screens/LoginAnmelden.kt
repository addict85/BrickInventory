package ch.brickinventoryapp.login.ui.screens

import androidx.compose.ui.focus.FocusManager
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.components.PasswordField
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.stateDescription
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.withFont

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AnmeldeFelder(
    username: String, onUsername: (String) -> Unit,
    password: String, onPassword: (String) -> Unit,
    codeNoetig: Boolean, code: String, onCode: (String) -> Unit,
    isLoading: Boolean, error: String?,
    registrierungOffen: Boolean?,
    focusMgr: FocusManager,
    onLogin: (String, String, String?) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
    vollerZugriff: Boolean,
    onVollerZugriff: (Boolean) -> Unit,
    onPasskey: (() -> Unit)?,
    onPasskeyStattCode: ((String, String) -> Unit)?,
) {
    LoginTitle(stringResource(R.string.login_title))
    // The button stays tappable; a tap with empty fields shows at the field what is missing.
    // Disabled and pale, it left one guessing why nothing happens.
    var versucht by rememberSaveable { mutableStateOf(false) }
    val nameMissing = versucht && username.isBlank()
    val passwordMissing = versucht && password.isBlank()
    val codeMissing = versucht && codeNoetig && code.isBlank()
    val anmelden = {
        versucht = true
        if (username.isNotBlank() && password.isNotBlank() && (!codeNoetig || code.isNotBlank()))
            onLogin(username, password, code.takeIf { codeNoetig })
    }

    OutlinedTextField(
        value = username, onValueChange = onUsername,
        label = { Text(stringResource(R.string.login_username)) },
        isError = nameMissing,
        supportingText = if (nameMissing) ({ Text(stringResource(R.string.login_username_fehlt)) }) else null,
        leadingIcon = { Icon(Icons.Default.Person, null) },
        // For the password manager: it only fills what it recognizes as a sign-in field.
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username }, singleLine = true,
        shape = Formen.feld,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
    )

    PasswordField(
        wert = password, onValue = onPassword,
        beschriftung = stringResource(R.string.login_password),
        modifier = Modifier.fillMaxWidth(),
        hinweis = if (passwordMissing) stringResource(R.string.login_password_fehlt) else null,
        faulty = passwordMissing,
        imeAction = if (codeNoetig) ImeAction.Next else ImeAction.Done,
        keyboardActions = KeyboardActions(
            onNext = { focusMgr.moveFocus(FocusDirection.Down) },
            onDone = {
                focusMgr.clearFocus()
                anmelden()
            }),
    )

    // Only visible once the server demands the second factor.
    // Text instead of number: a recovery code (letters) fits in it too.
    if (codeNoetig) {
        OutlinedTextField(
            value = code, onValueChange = { onCode(it.take(24)) },
            label = { Text(stringResource(R.string.login_code)) },
            isError = codeMissing,
            supportingText = { Text(stringResource(if (codeMissing) R.string.login_code_fehlt else R.string.login_code_hint)) },
            leadingIcon = { Icon(Icons.Default.Key, null) },
            // No SmsOtpCode: the code comes from an authenticator app, not by SMS, and
            // Compose has no autofill type for TOTP. The system otherwise offered SMS codes.
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Ascii),
            keyboardActions = KeyboardActions(onDone = { focusMgr.clearFocus(); anmelden() })
        )
    }

    if (error != null) FormMessage(error, fehler = true)

    // Without the checkbox, a token without admin rights, even for an admin account. Checking the
    // box asks for the device lock: a token with scope "voll" can do anything.
    // Collapsed under „Erweitert“: hardly anyone needs it to collect, and open
    // it pushed the sign-in button out of the first frame at 200 %.
    val protection = LocalSchrittschutz.current
    val fullReason = stringResource(R.string.schritt_voller_zugriff)
    var extended by rememberSaveable { mutableStateOf(vollerZugriff) }
    // The state for TalkBack: whether the section is open was otherwise only visible.
    val zustand = stringResource(if (extended) R.string.zustand_ausgeklappt else R.string.zustand_eingeklappt)
    TextButton(onClick = { extended = !extended }, modifier = Modifier.semantics {
        stateDescription = zustand
        if (extended) collapse { extended = false; true } else expand { extended = true; true }
    }) {
        Text(stringResource(R.string.login_erweitert))
        Icon(if (extended) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
    }
    // Flush at the top: the checkbox belongs to the first line, not the middle of the block
    // (three lines at large font).
    if (extended) Row(verticalAlignment = Alignment.Top,
        modifier = Modifier.fillMaxWidth().toggleable(value = vollerZugriff, role = Role.Checkbox,
            onValueChange = { an -> if (an) protection.confirm(fullReason) { onVollerZugriff(true) } else onVollerZugriff(false) })) {
        Checkbox(checked = vollerZugriff, onCheckedChange = null)
        Column(Modifier.padding(start = Abstaende.klein, top = Abstaende.hairline)) {
            Text(stringResource(R.string.login_full_access), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.login_full_access_hint), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    LoadButton(stringResource(R.string.login_button), laeuft = isLoading, aktiv = true, onClick = anmelden)

    // Instead of the code: name and password from above go along, the passkey only replaces the code.
    if (codeNoetig && onPasskeyStattCode != null) {
        OutlinedButton(onClick = { onPasskeyStattCode(username, password) },
            enabled = !isLoading && username.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(!isLoading && username.isNotBlank() && password.isNotBlank())) {
            Icon(Icons.Default.Fingerprint, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.login_passkey_statt_code))
        }
    } else if (!codeNoetig && onPasskey != null) {
        OutlinedButton(onClick = onPasskey, enabled = !isLoading,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(!isLoading)) {
            Icon(Icons.Default.Fingerprint, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.login_passkey))
        }
    }

    // The register link appears ONLY on an explicit `true`.
    // `null` means "not asked yet" or "the server did not
    // answer" — in both cases the button led nowhere.
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        if (registrierungOffen == true) {
            TextButton(onClick = { onFormular(AnmeldeFormular.REGISTER) }) {
                Text(stringResource(R.string.login_no_account), textAlign = TextAlign.Center)
            }
        }
        TextButton(onClick = { onFormular(AnmeldeFormular.PASSWORD_FORGOTTEN) }) {
            Text(stringResource(R.string.login_forgot), textAlign = TextAlign.Center)
        }
    }
}

@Composable
internal fun ForgottenFields(
    laeuft: Boolean, meldung: String?, fehler: String?,
    sendOn: (String) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var ownError by rememberSaveable { mutableStateOf<String?>(null) }
    val needsEmail = stringResource(R.string.forgot_email_required)

    LoginTitle(stringResource(R.string.forgot_title))

    if (meldung != null) {
        FormMessage(meldung, fehler = false)
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
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done,
                keyboardType = KeyboardType.Email))

        val showTo = ownError ?: fehler
        if (showTo != null) FormMessage(showTo, fehler = true)

        LoadButton(stringResource(R.string.forgot_button), laeuft = laeuft, aktiv = true) {
            ownError = if (email.isBlank()) needsEmail else null
            if (ownError == null) sendOn(email)
        }
    }

    TextButton(onClick = { onFormular(AnmeldeFormular.ANMELDEN) },
        modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.login_back))
    }
}
