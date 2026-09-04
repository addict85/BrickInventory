package ch.brickinventoryapp.ui.screens

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

/**
 * Anmelden, ein Konto anlegen, einen Link zum Zuruecksetzen anfordern.
 *
 * ── Warum hier drei Formulare stehen (Nachtrag 126) ─────────────────────────
 *
 * Die Webapp hat diese drei seit jeher (`showPanel('login'|'register'|'forgot')`
 * in public/js/01-core.js). Die App hatte nur das erste. Wer sie als Erstes
 * installierte, brauchte zwingend einen Browser, um ueberhaupt an ein Konto zu
 * kommen — und wer sein Passwort vergass, ebenso.
 *
 * Drei Formulare in EINEM Bildschirm statt drei Navigationszielen: Der
 * Zurueck-Knopf des Geraets soll dasselbe bedeuten wie „Zurueck zur Anmeldung"
 * im Formular. Mit eigenen Zielen waeren das zwei Wege, die auseinanderlaufen
 * koennen.
 *
 * Was hier NICHT steht, ist das Setzen des neuen Passworts. Der Link aus der
 * E-Mail traegt den Token in der Adresse und fuehrt zur Weboberflaeche des
 * Servers; ihn in der App abzufangen hiesse, einen Intent-Filter auf eine
 * Adresse zu legen, die jeder Nutzer selbst einstellt und die im Manifest
 * deshalb gar nicht stehen kann. Der Hinweistext sagt das dem Nutzer.
 */
@Composable
fun LoginScreen(
    serverUrl: String,
    isLoading: Boolean,
    error: String?,
    formular: AnmeldeFormular,
    registrierungOffen: Boolean?,
    kontoLaeuft: Boolean,
    kontoMeldung: String?,
    kontoFehler: String?,
    onLogin: (String, String) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
    onRegistrieren: (String, String, String, String, String) -> Unit,
    onPasswortVergessen: (String) -> Unit,
    onChangeServer: () -> Unit
) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPw   by rememberSaveable { mutableStateOf(false) }
    val focusMgr = LocalFocusManager.current

    Box(
        modifier = Modifier.fillMaxSize(),
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
                fontSize = 24.sp,
                letterSpacing = (-0.5).sp
            )
            Text(
                "Manager",
                fontWeight = FontWeight.Light,
                fontSize = 18.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))

            // Server chip
            AssistChip(
                onClick = onChangeServer,
                label = { Text(serverUrl, maxLines = 1, fontSize = 12.sp) },
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
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    when (formular) {
                        AnmeldeFormular.ANMELDEN -> AnmeldeFelder(
                            username = username, onUsername = { username = it },
                            password = password, onPassword = { password = it },
                            showPw = showPw, onShowPw = { showPw = it },
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
 * Eine stehende Meldung im Formular — Fehler rot, Bestaetigung ruhig.
 *
 * Stand dreimal fast gleich da (Anmelden, Registrieren, Vergessen). Genau die
 * Sorte Wiederholung, die auseinanderlaeuft: Beim dritten Mal haette der
 * Abstand oder die Randform schon nicht mehr gepasst.
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
            horizontalArrangement = Arrangement.spacedBy(8.dp),
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
        modifier = Modifier.fillMaxWidth().height(48.dp),
        enabled = !laeuft && aktiv,
        shape = Formen.knopf
    ) {
        if (laeuft) {
            CircularProgressIndicator(Modifier.size(18.dp),
                color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        } else {
            Text(text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun AnmeldeFelder(
    username: String, onUsername: (String) -> Unit,
    password: String, onPassword: (String) -> Unit,
    showPw: Boolean, onShowPw: (Boolean) -> Unit,
    isLoading: Boolean, error: String?,
    registrierungOffen: Boolean?,
    focusMgr: androidx.compose.ui.focus.FocusManager,
    onLogin: (String, String) -> Unit,
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
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Password),
        keyboardActions = KeyboardActions(onDone = {
            focusMgr.clearFocus()
            if (username.isNotBlank() && password.isNotBlank()) onLogin(username, password)
        })
    )

    if (error != null) FormularMeldung(error, fehler = true)

    LadeKnopf(
        stringResource(R.string.login_button),
        laeuft = isLoading,
        aktiv = username.isNotBlank() && password.isNotBlank()
    ) { onLogin(username, password) }

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
            // Dieselben drei Pruefungen wie im Web-Formular, und in derselben
            // Reihenfolge — die Laengengrenze von 8 Zeichen ist die des
            // Servers (routes/auth.ts). Hier vorweggenommen, damit man dafuer
            // nicht erst eine Runde ueber das Netz braucht.
            eigenerFehler = when {
                nutzer.isBlank() || email.isBlank() || pw1.isBlank() -> reqFields
                pw1.length < 8 -> zuKurz
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
