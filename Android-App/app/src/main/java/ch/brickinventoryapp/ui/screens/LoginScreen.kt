package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.util.passwortZuKurz
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Anmelden, Konto anlegen, Link zum Zurücksetzen anfordern — wie die Webapp. Drei
 * Formulare in einem Bildschirm, damit der Zurück-Knopf „zurück zur Anmeldung“
 * heisst. Das neue Passwort setzt die Weboberfläche: Den Link abzufangen bräuchte
 * einen Intent-Filter auf eine Adresse, die jeder selbst einstellt.
 */
@Composable
fun LoginScreen(
    serverUrl: String,
    isLoading: Boolean,
    error: String?,
    codeNoetig: Boolean,
    formular: AnmeldeFormular,
    registrierungOffen: Boolean?,
    kontoLaeuft: Boolean,
    kontoMeldung: String?,
    kontoFehler: String?,
    onLogin: (String, String, String?) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
    onRegistrieren: (String, String, String, String, String) -> Unit,
    onPasswortVergessen: (String) -> Unit,
    onChangeServer: () -> Unit,
    netzFrage: Boolean = false,
    onNetzBestaetigt: (String, String, String?) -> Unit = { _, _, _ -> },
    onNetzAbgelehnt: () -> Unit = {},
) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPw   by rememberSaveable { mutableStateOf(false) }
    var code     by rememberSaveable { mutableStateOf("") }
    val focusMgr = LocalFocusManager.current

    // Das Passwort geht erst nach einem ausdrücklichen Ja hinaus (AnmeldungViewModel.login).
    if (netzFrage) {
        AlertDialog(
            onDismissRequest = onNetzAbgelehnt,
            icon = { Icon(Icons.Default.Warning, null) },
            title = { Text(stringResource(R.string.login_netz_titel)) },
            text = { Text(stringResource(R.string.login_netz_text, serverUrl)) },
            confirmButton = {
                TextButton(onClick = { onNetzBestaetigt(username, password, code.takeIf { codeNoetig }) }) {
                    Text(stringResource(R.string.login_netz_trotzdem))
                }
            },
            dismissButton = {
                TextButton(onClick = onNetzAbgelehnt) { Text(stringResource(R.string.common_cancel)) }
            },
        )
    }

    // Rollbar: Auf einem kleinen Telefon, mit offener Tastatur oder grosser Schrift
    // läge der Anmeldeknopf sonst unerreichbar unter dem Rand.
    Box(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            // Logo
            Image(
                painter = painterResource(R.drawable.ic_logo),
                contentDescription = "BrickInventory Manager",
                modifier = Modifier.size(80.dp)
            )
            Spacer(Modifier.height(14.dp))
            Text(
                "BrickInventory",
                fontWeight = FontWeight.ExtraBold,
                style = MaterialTheme.typography.headlineSmall,
                letterSpacing = (-0.5).sp
            )
            Text(
                "Manager",
                fontWeight = FontWeight.Light,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(Abstaende.klein))

            // Server chip
            AssistChip(
                onClick = onChangeServer,
                label = { Text(serverUrl, maxLines = 1, style = MaterialTheme.typography.labelMedium) },
                leadingIcon = { Icon(Icons.Default.Cloud, null, Modifier.size(14.dp)) },
                trailingIcon = { Icon(Icons.Default.Edit, null, Modifier.size(12.dp)) },
                shape = Formen.chip
            )

            Spacer(Modifier.height(28.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = Formen.chip,
                elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
            ) {
                Column(
                    Modifier.padding(horizontal = 20.dp, vertical = 22.dp),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)
                ) {
                    when (formular) {
                        AnmeldeFormular.ANMELDEN -> AnmeldeFelder(
                            username = username, onUsername = { username = it },
                            password = password, onPassword = { password = it },
                            showPw = showPw, onShowPw = { showPw = it },
                            codeNoetig = codeNoetig, code = code, onCode = { code = it },
                            isLoading = isLoading, error = error,
                            registrierungOffen = registrierungOffen,
                            focusMgr = focusMgr,
                            onLogin = onLogin, onFormular = onFormular)

                        AnmeldeFormular.REGISTRIEREN -> RegistrierFelder(
                            laeuft = kontoLaeuft, meldung = kontoMeldung, fehler = kontoFehler,
                            focusMgr = focusMgr,
                            onRegistrieren = onRegistrieren, onFormular = onFormular)

                        AnmeldeFormular.PASSWORT_VERGESSEN -> VergessenFelder(
                            laeuft = kontoLaeuft, meldung = kontoMeldung, fehler = kontoFehler,
                            onSenden = onPasswortVergessen, onFormular = onFormular)
                    }
                }
            }
        }
    }
}

/**
 * Eine stehende Meldung im Formular — Fehler rot, Bestätigung ruhig. Eine Fassung
 * für Anmelden, Registrieren und Vergessen, damit Abstand und Randform überall
 * gleich bleiben.
 */
@Composable
private fun FormularMeldung(text: String, fehler: Boolean) {
    Surface(
        shape = Formen.kachel,
        color = if (fehler) MaterialTheme.colorScheme.errorContainer
                else MaterialTheme.colorScheme.secondaryContainer
    ) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (fehler) Icons.Default.Warning else Icons.Default.CheckCircle, null,
                Modifier.size(16.dp),
                tint = if (fehler) MaterialTheme.colorScheme.onErrorContainer
                       else MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text,
                color = if (fehler) MaterialTheme.colorScheme.onErrorContainer
                        else MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

/** Ein Knopf, der laedt: Kringel statt Beschriftung, solange etwas laeuft. */
@Composable
private fun LadeKnopf(text: String, laeuft: Boolean, aktiv: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        enabled = !laeuft && aktiv,
        shape = Formen.knopf
    ) {
        if (laeuft) {
            CircularProgressIndicator(Modifier.size(18.dp),
                color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        } else {
            Text(text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun AnmeldeFelder(
    username: String, onUsername: (String) -> Unit,
    password: String, onPassword: (String) -> Unit,
    showPw: Boolean, onShowPw: (Boolean) -> Unit,
    codeNoetig: Boolean, code: String, onCode: (String) -> Unit,
    isLoading: Boolean, error: String?,
    registrierungOffen: Boolean?,
    focusMgr: androidx.compose.ui.focus.FocusManager,
    onLogin: (String, String, String?) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
) {
    Text(
        stringResource(R.string.login_title),
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.titleMedium
    )

    OutlinedTextField(
        value = username, onValueChange = onUsername,
        label = { Text(stringResource(R.string.login_username)) },
        leadingIcon = { Icon(Icons.Default.Person, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.knopf,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
    )

    OutlinedTextField(
        value = password, onValueChange = onPassword,
        label = { Text(stringResource(R.string.login_password)) },
        leadingIcon = { Icon(Icons.Default.Lock, null) },
        trailingIcon = {
            IconButton(onClick = { onShowPw(!showPw) }) {
                Icon(
                    if (showPw) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                    // Beschreibt die WIRKUNG des Tippens, nicht das
                    // gezeigte Symbol — genau das braucht TalkBack.
                    stringResource(if (showPw) R.string.cd_password_hide else R.string.cd_password_show)
                )
            }
        },
        visualTransformation = if (showPw) VisualTransformation.None else PasswordVisualTransformation(),
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.knopf,
        keyboardOptions = KeyboardOptions(
            imeAction = if (codeNoetig) ImeAction.Next else ImeAction.Done,
            keyboardType = KeyboardType.Password),
        keyboardActions = KeyboardActions(
            onNext = { focusMgr.moveFocus(FocusDirection.Down) },
            onDone = {
                focusMgr.clearFocus()
                if (username.isNotBlank() && password.isNotBlank()) onLogin(username, password, null)
            })
    )

    // Erst sichtbar, wenn der Server den zweiten Faktor verlangt.
    // Text statt Zahl: Auch ein Wiederherstellungscode (Buchstaben) passt hinein.
    if (codeNoetig) {
        val absenden = { if (username.isNotBlank() && password.isNotBlank() && code.isNotBlank()) onLogin(username, password, code) }
        OutlinedTextField(
            value = code, onValueChange = { onCode(it.take(12)) },
            label = { Text(stringResource(R.string.login_code)) },
            supportingText = { Text(stringResource(R.string.login_code_hint)) },
            leadingIcon = { Icon(Icons.Default.Key, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.knopf,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Ascii),
            keyboardActions = KeyboardActions(onDone = { focusMgr.clearFocus(); absenden() })
        )
    }

    if (error != null) FormularMeldung(error, fehler = true)

    LadeKnopf(
        stringResource(R.string.login_button),
        laeuft = isLoading,
        aktiv = username.isNotBlank() && password.isNotBlank() && (!codeNoetig || code.isNotBlank())
    ) { onLogin(username, password, code.takeIf { codeNoetig }) }

    // Der Registrier-Link erscheint NUR bei einem ausdruecklichen `true`.
    // `null` heisst „noch nicht gefragt" oder „der Server hat nicht
    // geantwortet" — in beiden Faellen fuehrte der Knopf ins Leere.
    if (registrierungOffen == true) {
        TextButton(onClick = { onFormular(AnmeldeFormular.REGISTRIEREN) },
            modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.login_no_account))
        }
    }
    TextButton(onClick = { onFormular(AnmeldeFormular.PASSWORT_VERGESSEN) },
        modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.login_forgot))
    }
}

@Composable
private fun RegistrierFelder(
    laeuft: Boolean, meldung: String?, fehler: String?,
    focusMgr: androidx.compose.ui.focus.FocusManager,
    onRegistrieren: (String, String, String, String, String) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
) {
    var nutzer   by rememberSaveable { mutableStateOf("") }
    var email    by rememberSaveable { mutableStateOf("") }
    var vorname  by rememberSaveable { mutableStateOf("") }
    var nachname by rememberSaveable { mutableStateOf("") }
    var pw1      by rememberSaveable { mutableStateOf("") }
    var pw2      by rememberSaveable { mutableStateOf("") }
    // Was HIER schiefgeht, bevor ueberhaupt gesendet wird. Getrennt vom
    // Serverfehler, sonst ueberschreibt das eine das andere.
    var eigenerFehler by rememberSaveable { mutableStateOf<String?>(null) }

    val reqFields  = stringResource(R.string.register_req_fields)
    val zuKurz     = stringResource(R.string.register_password_short)
    val ungleich   = stringResource(R.string.register_password_mismatch)

    Text(stringResource(R.string.register_title),
        fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)

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
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = weiter, keyboardActions = naechstes)
        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text(stringResource(R.string.register_email)) },
            leadingIcon = { Icon(Icons.Default.Email, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next,
                keyboardType = KeyboardType.Email),
            keyboardActions = naechstes)
        OutlinedTextField(
            value = vorname, onValueChange = { vorname = it },
            label = { Text(stringResource(R.string.register_first_name)) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = weiter, keyboardActions = naechstes)
        OutlinedTextField(
            value = nachname, onValueChange = { nachname = it },
            label = { Text(stringResource(R.string.register_last_name)) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = weiter, keyboardActions = naechstes)
        OutlinedTextField(
            value = pw1, onValueChange = { pw1 = it },
            label = { Text(stringResource(R.string.login_password)) },
            leadingIcon = { Icon(Icons.Default.Lock, null) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next,
                keyboardType = KeyboardType.Password),
            keyboardActions = naechstes)
        OutlinedTextField(
            value = pw2, onValueChange = { pw2 = it },
            label = { Text(stringResource(R.string.register_password_repeat)) },
            leadingIcon = { Icon(Icons.Default.Lock, null) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done,
                keyboardType = KeyboardType.Password))

        val zuZeigen = eigenerFehler ?: fehler
        if (zuZeigen != null) FormularMeldung(zuZeigen, fehler = true)

        LadeKnopf(stringResource(R.string.register_button), laeuft = laeuft, aktiv = true) {
            // Dieselben drei Prüfungen wie im Web-Formular, in derselben Reihenfolge; die
            // Längengrenze von 8 Zeichen ist die des Servers (routes/auth.ts). Hier
            // vorweggenommen, damit man dafür keine Runde über das Netz braucht.
            eigenerFehler = when {
                nutzer.isBlank() || email.isBlank() || pw1.isBlank() -> reqFields
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

@Composable
private fun VergessenFelder(
    laeuft: Boolean, meldung: String?, fehler: String?,
    onSenden: (String) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var eigenerFehler by rememberSaveable { mutableStateOf<String?>(null) }
    val brauchtEmail = stringResource(R.string.forgot_email_required)

    Text(stringResource(R.string.forgot_title),
        fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)

    if (meldung != null) {
        FormularMeldung(meldung, fehler = false)
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
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done,
                keyboardType = KeyboardType.Email))

        val zuZeigen = eigenerFehler ?: fehler
        if (zuZeigen != null) FormularMeldung(zuZeigen, fehler = true)

        LadeKnopf(stringResource(R.string.forgot_button), laeuft = laeuft, aktiv = true) {
            eigenerFehler = if (email.isBlank()) brauchtEmail else null
            if (eigenerFehler == null) onSenden(email)
        }
    }

    TextButton(onClick = { onFormular(AnmeldeFormular.ANMELDEN) },
        modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.login_back))
    }
}
