package ch.brickinventoryapp.login.ui.screens

import androidx.compose.ui.focus.FocusManager
import ch.brickinventoryapp.ui.theme.Formen
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
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.*
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.model.util.passwordToShort
import ch.brickinventoryapp.model.util.PASSWORD_MIN_CHARS
import ch.brickinventoryapp.ui.components.PasswordKind
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LoginTitle

@Composable
internal fun RegistrierFields(
    laeuft: Boolean, meldung: String?, fehler: String?,
    focusMgr: FocusManager,
    namesSideBySide: Boolean,
    onRegistrieren: (String, String, String, String, String) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
) {
    var nutzer   by rememberSaveable { mutableStateOf("") }
    var email    by rememberSaveable { mutableStateOf("") }
    var vorname  by rememberSaveable { mutableStateOf("") }
    var nachname by rememberSaveable { mutableStateOf("") }
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
    if (meldung != null) {
        FormMessage(meldung, fehler = false)
    } else {
        val weiter = KeyboardOptions(imeAction = ImeAction.Next)
        val next = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
        OutlinedTextField(
            value = nutzer, onValueChange = { nutzer = it },
            label = { Text(stringResource(R.string.login_username)) },
            leadingIcon = { Icon(Icons.Default.Person, null) },
            modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.NewUsername }, singleLine = true, shape = Formen.feld,
            keyboardOptions = weiter, keyboardActions = next)
        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text(stringResource(R.string.register_email)) },
            leadingIcon = { Icon(Icons.Default.Email, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next,
                keyboardType = KeyboardType.Email),
            keyboardActions = next)
        NamedFields(vorname, { vorname = it }, nachname, { nachname = it }, namesSideBySide, next)
        // The minimum length is shown from the start, not only as an error after sending.
        PasswordField(pw1, { pw1 = it }, stringResource(R.string.login_password), Modifier.fillMaxWidth(),
            art = PasswordKind.NEU, hinweis = pluralStringResource(R.plurals.passwort_mindestens, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS),
            imeAction = ImeAction.Next, keyboardActions = next)
        PasswordField(pw2, { pw2 = it }, stringResource(R.string.register_password_repeat), Modifier.fillMaxWidth(),
            art = PasswordKind.WIEDERHOLUNG)

        val showTo = ownError ?: fehler
        if (showTo != null) FormMessage(showTo, fehler = true)

        // The same rule as for sign-in: disabled when empty, what is missing stands above it.
        val vollstaendig = nutzer.isNotBlank() && email.isNotBlank() && pw1.isNotBlank()
        LoadButton(stringResource(R.string.register_button), laeuft = laeuft, aktiv = vollstaendig, fehlt = reqFields) {
            // The same checks as in the web form, in the same order; the
            // length limit (PASSWORD_MIN_CHARS) is the server's (routes/auth.ts). Anticipated
            // here, so that it needs no round trip over the network.
            ownError = when {
                passwordToShort(pw1) -> toShort
                pw1 != pw2     -> unequal
                else           -> null
            }
            if (ownError == null) onRegistrieren(nutzer, email, vorname, nachname, pw1)
        }
    }

    TextButton(onClick = { onFormular(AnmeldeFormular.ANMELDEN) },
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
    vorname: String, onFirstName: (String) -> Unit, nachname: String, onLastName: (String) -> Unit,
    sideBySide: Boolean, next: KeyboardActions,
) {
    val feld: @Composable (String, (String) -> Unit, Int, Modifier) -> Unit = { wert, onValue, label, breite ->
        OutlinedTextField(
            value = wert, onValueChange = onValue,
            label = { Text(stringResource(label)) },
            leadingIcon = { Icon(Icons.Default.Badge, null) },
            modifier = breite, singleLine = true, shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), keyboardActions = next)
    }
    if (sideBySide) Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
        feld(vorname, onFirstName, R.string.register_first_name, Modifier.weight(1f))
        feld(nachname, onLastName, R.string.register_last_name, Modifier.weight(1f))
    } else {
        feld(vorname, onFirstName, R.string.register_first_name, Modifier.fillMaxWidth())
        feld(nachname, onLastName, R.string.register_last_name, Modifier.fillMaxWidth())
    }
}
