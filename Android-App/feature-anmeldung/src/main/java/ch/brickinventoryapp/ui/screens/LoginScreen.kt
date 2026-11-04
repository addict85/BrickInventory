package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.foundation.verticalScroll
import ch.brickinventoryapp.ui.theme.mittigBis
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
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.util.passwortZuKurz
import ch.brickinventoryapp.util.PASSWORT_MIN_ZEICHEN
import ch.brickinventoryapp.ui.components.PasswortArt
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.ui.components.ansagen
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
    vollerZugriff: Boolean = false,
    onVollerZugriff: (Boolean) -> Unit = {},
    /** null: kein Passkey-Knopf (etwa in Vorschau und Test). */
    onPasskey: (() -> Unit)? = null,
    passkeyStattCode: Boolean = false,
    onPasskeyStattCode: (String, String) -> Unit = { _, _ -> },
) {
    var username by rememberSaveable { mutableStateOf("") }
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var password by remember { mutableStateOf("") }
    var code     by remember { mutableStateOf("") }
    val focusMgr = LocalFocusManager.current
    // Ein untergeschobener Tipp meldet hier an oder bestätigt einen Passkey. Den
    // Sichtschutz für ein aufgedecktes Passwort bringt das PasswortFeld selbst mit.
    ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()

    // Passwort, Code und Adresse lernt die Tastatur nicht mit (sec8 H4).
    ch.brickinventoryapp.ui.components.TastaturOhneLernen {
    // Rollbar: Auf einem kleinen Telefon, mit offener Tastatur oder grosser Schrift
    // läge der Anmeldeknopf sonst unerreichbar unter dem Rand.
    Box(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .mittigBis(ch.brickinventoryapp.ui.theme.Lesebreite.formular)
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            // Derselbe Kopf wie beim Einrichten, das direkt davor kommt.
            ch.brickinventoryapp.ui.components.MarkenKopf()
            Spacer(Modifier.height(Abstaende.mittel))

            // Der Chip wechselt den Server: TalkBack nennt das samt Adresse (die Fläche fasst
            // die Beschreibung mit ihrer Rolle „Schaltfläche“ zusammen). Die Adresse bricht
            // um statt gekürzt zu werden: Genau sie prüft man vor dem Anmelden.
            val serverAendern = stringResource(R.string.login_server_aendern, serverUrl)
            Surface(
                onClick = onChangeServer,
                shape = Formen.chip,
                color = MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Row(Modifier.heightIn(min = 32.dp).padding(horizontal = Abstaende.klein, vertical = Abstaende.winzig),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Icon(Icons.Default.Cloud, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)),
                        tint = MaterialTheme.colorScheme.primary)
                    Text(serverUrl, Modifier.weight(1f, fill = false).semantics { contentDescription = serverAendern },
                        style = MaterialTheme.typography.labelMedium)
                    Icon(Icons.Default.Edit, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)),
                        tint = MaterialTheme.colorScheme.primary)
                }
            }

            Spacer(Modifier.height(28.dp))

            ch.brickinventoryapp.ui.components.AnmeldeKarte {
                when (formular) {
                    AnmeldeFormular.ANMELDEN -> AnmeldeFelder(
                        username = username, onUsername = { username = it },
                        password = password, onPassword = { password = it },
                        codeNoetig = codeNoetig, code = code, onCode = { code = it },
                        isLoading = isLoading, error = error,
                        registrierungOffen = registrierungOffen,
                        focusMgr = focusMgr,
                        onLogin = onLogin, onFormular = onFormular,
                        vollerZugriff = vollerZugriff, onVollerZugriff = onVollerZugriff,
                        onPasskey = onPasskey,
                        onPasskeyStattCode = onPasskeyStattCode.takeIf { passkeyStattCode && onPasskey != null })

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
                // Angesagt: Nach „Anmelden“ hörte eine blinde Person sonst nichts.
                modifier = Modifier.ansagen(),
                color = if (fehler) MaterialTheme.colorScheme.onErrorContainer
                        else MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

/** Ein Knopf, der laedt: Kringel statt Beschriftung, solange etwas laeuft. */
@Composable
private fun LadeKnopf(text: String, laeuft: Boolean, aktiv: Boolean, fehlt: String? = null, onClick: () -> Unit) {
    // Ein gesperrter Hauptknopf sagt, was fehlt: Blass allein liess raten, warum.
    if (!aktiv && !laeuft && fehlt != null) Text(fehlt, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        enabled = !laeuft && aktiv
    ) {
        if (laeuft) {
            CircularProgressIndicator(Modifier.size(18.dp),
                color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        } else {
            Text(text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AnmeldeFelder(
    username: String, onUsername: (String) -> Unit,
    password: String, onPassword: (String) -> Unit,
    codeNoetig: Boolean, code: String, onCode: (String) -> Unit,
    isLoading: Boolean, error: String?,
    registrierungOffen: Boolean?,
    focusMgr: androidx.compose.ui.focus.FocusManager,
    onLogin: (String, String, String?) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
    vollerZugriff: Boolean,
    onVollerZugriff: (Boolean) -> Unit,
    onPasskey: (() -> Unit)?,
    onPasskeyStattCode: ((String, String) -> Unit)?,
) {
    ch.brickinventoryapp.ui.components.AnmeldeTitel(stringResource(R.string.login_title))

    OutlinedTextField(
        value = username, onValueChange = onUsername,
        label = { Text(stringResource(R.string.login_username)) },
        leadingIcon = { Icon(Icons.Default.Person, null) },
        // Für den Passwortmanager: Er füllt nur, was er als Anmeldefeld erkennt.
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username }, singleLine = true,
        shape = Formen.feld,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { focusMgr.moveFocus(FocusDirection.Down) })
    )

    PasswortFeld(
        wert = password, onWert = onPassword,
        beschriftung = stringResource(R.string.login_password),
        modifier = Modifier.fillMaxWidth(),
        mitSymbol = true,
        imeAction = if (codeNoetig) ImeAction.Next else ImeAction.Done,
        keyboardActions = KeyboardActions(
            onNext = { focusMgr.moveFocus(FocusDirection.Down) },
            onDone = {
                focusMgr.clearFocus()
                if (username.isNotBlank() && password.isNotBlank()) onLogin(username, password, null)
            }),
    )

    // Erst sichtbar, wenn der Server den zweiten Faktor verlangt.
    // Text statt Zahl: Auch ein Wiederherstellungscode (Buchstaben) passt hinein.
    if (codeNoetig) {
        val absenden = { if (username.isNotBlank() && password.isNotBlank() && code.isNotBlank()) onLogin(username, password, code) }
        OutlinedTextField(
            value = code, onValueChange = { onCode(it.take(24)) },
            label = { Text(stringResource(R.string.login_code)) },
            supportingText = { Text(stringResource(R.string.login_code_hint)) },
            leadingIcon = { Icon(Icons.Default.Key, null) },
            // Das System bietet einen eben empfangenen Code zum Einsetzen an.
            modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode }, singleLine = true,
            shape = Formen.feld,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Ascii),
            keyboardActions = KeyboardActions(onDone = { focusMgr.clearFocus(); absenden() })
        )
    }

    if (error != null) FormularMeldung(error, fehler = true)

    // Ohne Häkchen ein Token ohne Verwalterrechte, auch für ein Verwalterkonto. Das
    // Häkchen setzen fragt die Gerätesperre: Ein Token mit Scope voll darf alles.
    // Eingeklappt unter „Erweitert“: Zum Sammeln braucht es niemand, und offen schob
    // es bei 200 % den Anmeldeknopf aus dem ersten Bild.
    val schutz = ch.brickinventoryapp.ui.components.LocalSchrittschutz.current
    val vollGrund = stringResource(R.string.schritt_voller_zugriff)
    var erweitert by rememberSaveable { mutableStateOf(vollerZugriff) }
    TextButton(onClick = { erweitert = !erweitert }) {
        Text(stringResource(R.string.login_erweitert))
        Icon(if (erweitert) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
    }
    // Oben bündig: Das Häkchen gehört zur ersten Zeile, nicht zur Mitte des Blocks
    // (bei grosser Schrift drei Zeilen).
    if (erweitert) Row(verticalAlignment = Alignment.Top,
        modifier = Modifier.fillMaxWidth().toggleable(value = vollerZugriff, role = Role.Checkbox,
            onValueChange = { an -> if (an) schutz.bestaetige(vollGrund) { onVollerZugriff(true) } else onVollerZugriff(false) })) {
        Checkbox(checked = vollerZugriff, onCheckedChange = null)
        Column(Modifier.padding(start = 8.dp, top = Abstaende.haar)) {
            Text(stringResource(R.string.login_full_access), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.login_full_access_hint), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    LadeKnopf(
        stringResource(R.string.login_button),
        laeuft = isLoading,
        aktiv = username.isNotBlank() && password.isNotBlank() && (!codeNoetig || code.isNotBlank()),
        fehlt = stringResource(when {
            username.isBlank() || password.isBlank() -> R.string.login_missing_credentials
            else -> R.string.login_missing_code
        }),
    ) { onLogin(username, password, code.takeIf { codeNoetig }) }

    // Statt des Codes: Name und Passwort von oben gehen mit, der Passkey ersetzt nur den Code.
    if (codeNoetig && onPasskeyStattCode != null) {
        OutlinedButton(onClick = { onPasskeyStattCode(username, password) },
            enabled = !isLoading && username.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(!isLoading && username.isNotBlank() && password.isNotBlank())) {
            Icon(Icons.Default.Fingerprint, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.login_passkey_statt_code))
        }
    } else if (!codeNoetig && onPasskey != null) {
        OutlinedButton(onClick = onPasskey, enabled = !isLoading,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(!isLoading)) {
            Icon(Icons.Default.Fingerprint, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.login_passkey))
        }
    }

    // Der Registrier-Link erscheint NUR bei einem ausdruecklichen `true`.
    // `null` heisst „noch nicht gefragt" oder „der Server hat nicht
    // geantwortet" — in beiden Faellen fuehrte der Knopf ins Leere.
    // Beide Verweise in einer umbrechenden Reihe: untereinander lag zwischen ihnen der
    // doppelte Abstand des Formulars.
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        if (registrierungOffen == true) {
            TextButton(onClick = { onFormular(AnmeldeFormular.REGISTRIEREN) }) {
                Text(stringResource(R.string.login_no_account))
            }
        }
        TextButton(onClick = { onFormular(AnmeldeFormular.PASSWORT_VERGESSEN) }) {
            Text(stringResource(R.string.login_forgot))
        }
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
    // Passwörter nur in remember, siehe oben.
    var pw1      by remember { mutableStateOf("") }
    var pw2      by remember { mutableStateOf("") }
    // Was HIER schiefgeht, bevor ueberhaupt gesendet wird. Getrennt vom
    // Serverfehler, sonst ueberschreibt das eine das andere.
    var eigenerFehler by rememberSaveable { mutableStateOf<String?>(null) }

    val reqFields  = stringResource(R.string.register_req_fields)
    val zuKurz     = stringResource(R.string.register_password_short)
    val ungleich   = stringResource(R.string.register_password_mismatch)

    ch.brickinventoryapp.ui.components.AnmeldeTitel(stringResource(R.string.register_title))

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
        OutlinedTextField(
            value = vorname, onValueChange = { vorname = it },
            label = { Text(stringResource(R.string.register_first_name)) },
            leadingIcon = { Icon(Icons.Default.Badge, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
            keyboardOptions = weiter, keyboardActions = naechstes)
        OutlinedTextField(
            value = nachname, onValueChange = { nachname = it },
            label = { Text(stringResource(R.string.register_last_name)) },
            leadingIcon = { Icon(Icons.Default.Badge, null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
            keyboardOptions = weiter, keyboardActions = naechstes)
        // Die Mindestlänge steht von Anfang an da, nicht erst als Fehler nach dem Senden.
        PasswortFeld(pw1, { pw1 = it }, stringResource(R.string.login_password), Modifier.fillMaxWidth(),
            art = PasswortArt.NEU, hinweis = pluralStringResource(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN),
            mitSymbol = true, imeAction = ImeAction.Next, keyboardActions = naechstes)
        PasswortFeld(pw2, { pw2 = it }, stringResource(R.string.register_password_repeat), Modifier.fillMaxWidth(),
            art = PasswortArt.WIEDERHOLUNG, mitSymbol = true)

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

@Composable
private fun VergessenFelder(
    laeuft: Boolean, meldung: String?, fehler: String?,
    onSenden: (String) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var eigenerFehler by rememberSaveable { mutableStateOf<String?>(null) }
    val brauchtEmail = stringResource(R.string.forgot_email_required)

    ch.brickinventoryapp.ui.components.AnmeldeTitel(stringResource(R.string.forgot_title))

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
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
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
