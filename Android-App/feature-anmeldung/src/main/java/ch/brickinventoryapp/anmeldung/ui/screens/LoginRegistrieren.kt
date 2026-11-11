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
import ch.brickinventoryapp.sicherheit.passwortZuKurz
import ch.brickinventoryapp.sicherheit.PASSWORT_MIN_ZEICHEN
import ch.brickinventoryapp.ui.components.PasswortArt
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.AnmeldeTitel

@Composable
internal fun RegistrierFelder(
    laeuft: Boolean, meldung: String?, fehler: String?,
    focusMgr: FocusManager,
    namenNebeneinander: Boolean,
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
    // Was HIER schiefgeht, bevor ueberhaupt gesendet wird. Getrennt vom
    // Serverfehler, sonst ueberschreibt das eine das andere.
    var eigenerFehler by rememberSaveable { mutableStateOf<String?>(null) }

    val reqFields  = stringResource(R.string.register_req_fields)
    val zuKurz     = stringResource(R.string.register_password_short)
    val ungleich   = stringResource(R.string.register_password_mismatch)

    AnmeldeTitel(stringResource(R.string.register_title))

    // Nach einer erfolgreichen Registrierung stehen nur noch die Meldung und
    // der Weg zurueck — die Felder waeren jetzt nur eine Einladung, dasselbe
    // Konto ein zweites Mal anzulegen. Genauso macht es die Webapp
    // (`reg-form` verbergen, `reg-success` zeigen).
    if (meldung != null) {
        FormularMeldung(meldung, fehler = false)
    } else {
        val weiter = KeyboardOptions(imeAction = ImeAction.Next)
        val naechstes = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
        OutlinedTextField(
            value = nutzer, onValueChange = { nutzer = it },
            label = { Text(stringResource(R.string.login_username)) },
            leadingIcon = { Icon(Icons.Default.Person, null) },
            modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.NewUsername }, singleLine = true, shape = Formen.feld,
            keyboardOptions = weiter, keyboardActions = naechstes)
        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text(stringResource(R.string.register_email)) },
            leadingIcon = { Icon(Icons.Default.Email, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next,
                keyboardType = KeyboardType.Email),
            keyboardActions = naechstes)
        NamensFelder(vorname, { vorname = it }, nachname, { nachname = it }, namenNebeneinander, naechstes)
        // Die Mindestlänge steht von Anfang an da, nicht erst als Fehler nach dem Senden.
        PasswortFeld(pw1, { pw1 = it }, stringResource(R.string.login_password), Modifier.fillMaxWidth(),
            art = PasswortArt.NEU, hinweis = pluralStringResource(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN),
            imeAction = ImeAction.Next, keyboardActions = naechstes)
        PasswortFeld(pw2, { pw2 = it }, stringResource(R.string.register_password_repeat), Modifier.fillMaxWidth(),
            art = PasswortArt.WIEDERHOLUNG)

        val zuZeigen = eigenerFehler ?: fehler
        if (zuZeigen != null) FormularMeldung(zuZeigen, fehler = true)

        // Dieselbe Regel wie beim Anmelden: leer gesperrt, darüber steht, was fehlt.
        val vollstaendig = nutzer.isNotBlank() && email.isNotBlank() && pw1.isNotBlank()
        LadeKnopf(stringResource(R.string.register_button), laeuft = laeuft, aktiv = vollstaendig, fehlt = reqFields) {
            // Dieselben Prüfungen wie im Web-Formular, in derselben Reihenfolge; die
            // Längengrenze (PASSWORT_MIN_ZEICHEN) ist die des Servers (routes/auth.ts). Hier
            // vorweggenommen, damit man dafür keine Runde über das Netz braucht.
            eigenerFehler = when {
                passwortZuKurz(pw1) -> zuKurz
                pw1 != pw2     -> ungleich
                else           -> null
            }
            if (eigenerFehler == null) onRegistrieren(nutzer, email, vorname, nachname, pw1)
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
private fun NamensFelder(
    vorname: String, onVorname: (String) -> Unit, nachname: String, onNachname: (String) -> Unit,
    nebeneinander: Boolean, naechstes: KeyboardActions,
) {
    val feld: @Composable (String, (String) -> Unit, Int, Modifier) -> Unit = { wert, onWert, label, breite ->
        OutlinedTextField(
            value = wert, onValueChange = onWert,
            label = { Text(stringResource(label)) },
            leadingIcon = { Icon(Icons.Default.Badge, null) },
            modifier = breite, singleLine = true, shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), keyboardActions = naechstes)
    }
    if (nebeneinander) Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
        feld(vorname, onVorname, R.string.register_first_name, Modifier.weight(1f))
        feld(nachname, onNachname, R.string.register_last_name, Modifier.weight(1f))
    } else {
        feld(vorname, onVorname, R.string.register_first_name, Modifier.fillMaxWidth())
        feld(nachname, onNachname, R.string.register_last_name, Modifier.fillMaxWidth())
    }
}
