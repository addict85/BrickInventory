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
    // Der Knopf bleibt tippbar; ein Tipp mit leeren Feldern zeigt am Feld, was fehlt.
    // Gesperrt und blass liess er raten, warum nichts geschieht.
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
        // Für den Passwortmanager: Er füllt nur, was er als Anmeldefeld erkennt.
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

    // Erst sichtbar, wenn der Server den zweiten Faktor verlangt.
    // Text statt Zahl: Auch ein Wiederherstellungscode (Buchstaben) passt hinein.
    if (codeNoetig) {
        OutlinedTextField(
            value = code, onValueChange = { onCode(it.take(24)) },
            label = { Text(stringResource(R.string.login_code)) },
            isError = codeMissing,
            supportingText = { Text(stringResource(if (codeMissing) R.string.login_code_fehlt else R.string.login_code_hint)) },
            leadingIcon = { Icon(Icons.Default.Key, null) },
            // Kein SmsOtpCode: Der Code kommt aus einer Authenticator-App, nicht per SMS, und
            // Compose kennt keinen Autofill-Typ für TOTP. Das System bot sonst SMS-Codes an.
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Ascii),
            keyboardActions = KeyboardActions(onDone = { focusMgr.clearFocus(); anmelden() })
        )
    }

    if (error != null) FormMessage(error, fehler = true)

    // Ohne Häkchen ein Token ohne Verwalterrechte, auch für ein Verwalterkonto. Das
    // Häkchen setzen fragt die Gerätesperre: Ein Token mit Scope voll darf alles.
    // Eingeklappt unter „Erweitert“: Zum Sammeln braucht es niemand, und offen schob
    // es bei 200 % den Anmeldeknopf aus dem ersten Bild.
    val protection = LocalSchrittschutz.current
    val fullReason = stringResource(R.string.schritt_voller_zugriff)
    var extended by rememberSaveable { mutableStateOf(vollerZugriff) }
    // Der Zustand für TalkBack: Ob der Bereich offen ist, sah man sonst nur.
    val zustand = stringResource(if (extended) R.string.zustand_ausgeklappt else R.string.zustand_eingeklappt)
    TextButton(onClick = { extended = !extended }, modifier = Modifier.semantics {
        stateDescription = zustand
        if (extended) collapse { extended = false; true } else expand { extended = true; true }
    }) {
        Text(stringResource(R.string.login_erweitert))
        Icon(if (extended) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
    }
    // Oben bündig: Das Häkchen gehört zur ersten Zeile, nicht zur Mitte des Blocks
    // (bei grosser Schrift drei Zeilen).
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

    // Statt des Codes: Name und Passwort von oben gehen mit, der Passkey ersetzt nur den Code.
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

    // Der Registrier-Link erscheint NUR bei einem ausdruecklichen `true`.
    // `null` heisst „noch nicht gefragt" oder „der Server hat nicht
    // geantwortet" — in beiden Faellen fuehrte der Knopf ins Leere.
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
        // Sagt, WOHIN der Link fuehrt. Er traegt den Token in der Adresse und
        // oeffnet die Weboberflaeche des Servers — die App kann ihn nicht
        // abfangen, weil die Serveradresse jeder selbst einstellt und deshalb
        // in keinem Intent-Filter stehen kann.
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
