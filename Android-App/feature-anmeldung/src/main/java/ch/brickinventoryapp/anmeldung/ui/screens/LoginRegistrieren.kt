package ch.brickinventoryapp.anmeldung.ui.screens

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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.anmeldung.ui.AnmeldeFormular
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
    // Passwörter nur in remember, siehe oben.
    var pw1      by remember { mutableStateOf("") }
    var pw2      by remember { mutableStateOf("") }
    // Was HERE schiefgeht, bevor ueberhaupt gesendet wird. Getrennt vom
    // Serverfehler, sonst ueberschreibt das eine das andere.
    var ownError by rememberSaveable { mutableStateOf<String?>(null) }

    val reqFields  = stringResource(R.string.register_req_fields)
    val toShort     = stringResource(R.string.register_password_short)
    val unequal   = stringResource(R.string.register_password_mismatch)

    LoginTitle(stringResource(R.string.register_title))

    // Nach einer erfolgreichen Registrierung stehen nur noch die Meldung und
    // der Weg zurueck — die Felder waeren jetzt nur eine Einladung, dasselbe
    // Konto ein zweites Mal anzulegen. Genauso macht es die Webapp
    // (`reg-form` verbergen, `reg-success` zeigen).
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
        // Die Mindestlänge steht von Anfang an da, nicht erst als Fehler nach dem Senden.
        PasswordField(pw1, { pw1 = it }, stringResource(R.string.login_password), Modifier.fillMaxWidth(),
            art = PasswordKind.NEU, hinweis = pluralStringResource(R.plurals.passwort_mindestens, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS),
            imeAction = ImeAction.Next, keyboardActions = next)
        PasswordField(pw2, { pw2 = it }, stringResource(R.string.register_password_repeat), Modifier.fillMaxWidth(),
            art = PasswordKind.WIEDERHOLUNG)

        val showTo = ownError ?: fehler
        if (showTo != null) FormMessage(showTo, fehler = true)

        // Dieselbe Regel wie beim Anmelden: leer gesperrt, darüber steht, was fehlt.
        val vollstaendig = nutzer.isNotBlank() && email.isNotBlank() && pw1.isNotBlank()
        LoadButton(stringResource(R.string.register_button), laeuft = laeuft, aktiv = vollstaendig, fehlt = reqFields) {
            // Dieselben Prüfungen wie im Web-Formular, in derselben Reihenfolge; die
            // Längengrenze (PASSWORD_MIN_CHARS) ist die des Servers (routes/auth.ts). Hier
            // vorweggenommen, damit man dafür keine Runde über das Netz braucht.
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
 * Vor- und Nachname; auf dem Tablet in einer Zeile: Sechs Felder untereinander
 * schoben „Registrieren“ unter den Falz.
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
