package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.beschreibung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.components.SecondFactorCodeField
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.text.KeyboardActions
import ch.brickinventoryapp.ui.components.PasswordSwitchFields
import ch.brickinventoryapp.ui.components.PasswordSwitchCheck
import ch.brickinventoryapp.ui.components.rememberPasswordSwitchCheck
import ch.brickinventoryapp.ui.theme.mainButtonColors
import ch.brickinventoryapp.ui.theme.toneButtonColors
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.DesignChoice
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.ui.components.PasswordPrompt
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.SettingsCard

/**
 * Das eigene Konto: Profil und Passwort. Über /auth/profile und
 * /auth/change-password, die auch das Bearer-Token der App annehmen.
 */
@Composable
internal fun AccountCard(
    // `kontoZustand`, nicht `zustand`: Die Kontoseiten nehmen `zustand` schon für andere
    // Zustände, und derselbe Name für zwei Typen verwechselt sich beim Lesen.
    kontoZustand: AccountUiState,
    onSpeichern: (String, String, String, String, String?, String?) -> Unit,
    onPassword: (String, String, String?) -> Unit,
    onMessageRoute: () -> Unit,
) {
    val profile = kontoZustand.profile
    // Die Felder werden aus dem Serverstand vorbelegt und danach vom Nutzer
    // gefuehrt. `remember(profile)` und nicht `remember`: Nach dem Speichern
    // holt das ViewModel das Profil neu, und die Felder sollen den
    // NORMALISIERTEN Stand des Servers zeigen, nicht das Getippte.
    var benutzername by remember(profile) { mutableStateOf(profile?.username.orEmpty()) }
    var email        by remember(profile) { mutableStateOf(profile?.email.orEmpty()) }
    var vorname      by remember(profile) { mutableStateOf(profile?.firstName.orEmpty()) }
    var nachname     by remember(profile) { mutableStateOf(profile?.lastName.orEmpty()) }
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var pwCurrent    by remember { mutableStateOf("") }
    var pwNeu        by remember { mutableStateOf("") }
    var pwRepeated by remember { mutableStateOf("") }
    // Das Passwort für eine Profiländerung fragt erst der Dialog beim Speichern ab.
    var asksPassword by remember(profile) { mutableStateOf(false) }
    var faktorCode   by remember { mutableStateOf("") }
    val code = faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() }

    val geaendert = profileChanged(profile, benutzername, email, vorname, nachname)
    // Speichern bleibt antippbar und markiert dann, was fehlt (wie beim Set-Dialog).
    var profileChecked by rememberSaveable(profile) { mutableStateOf(false) }
    val profileFocus = remember { ProfileField.entries.associateWith { FocusRequester() } }
    val passwordCheck = rememberPasswordSwitchCheck()

    // „Profil“, nicht „Konto“: Die Leiste der Seite heisst schon so.
    SettingsCard(title = stringResource(R.string.konto_profil_titel), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.abruf.laedt && profile == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        AccountMessages(kontoZustand)
        // Erst nachdem der Server ihn verlangt hat; gilt für E-Mail und Passwort.
        if (kontoZustand.codeNoetig) SecondFactorCodeField(faktorCode) { faktorCode = it }

        if (profile != null) {
            val tippen: (String) -> Unit = { onMessageRoute() }
            ProfileFields(profile,
                fehler = if (profileChecked) profileError(benutzername, email) else emptyList(),
                fokus = profileFocus,
                benutzername = benutzername, onUsername = { benutzername = it; tippen(it) },
                email = email, onEmail = { email = it; tippen(it) },
                vorname = vorname, onFirstName = { vorname = it; tippen(it) },
                nachname = nachname, onLastName = { nachname = it; tippen(it) })
            // Erst den Fokus abgeben: Sonst bleibt das zuletzt getippte Feld hinter dem
            // Dialog fokussiert und hält Tastatur und Cursor, obwohl nur der Dialog
            // Eingaben annimmt.
            val fokus = LocalFocusManager.current
            ProfileSaveButton(nothingChanged = profileChecked && !geaendert, speichert = kontoZustand.speichern.laeuft) {
                profileChecked = true
                val erstes = profileError(benutzername, email).firstOrNull()
                if (erstes != null) profileFocus.getValue(erstes).requestFocus()
                else if (geaendert) { fokus.clearFocus(); asksPassword = true }
            }
        }
    }

    // Eine eigene Karte unter eigener Überschrift: Unter „Profil“ las sich das Passwort
    // als Teil der Angaben, die „Profil speichern“ sichert.
    if (profile != null) {
        PasswordCard(
            pwCurrent = pwCurrent, onPwCurrent = { pwCurrent = it },
            pwNeu = pwNeu, onPwNew = { pwNeu = it },
            pwRepeated = pwRepeated, onPwRepeated = { pwRepeated = it },
            speichert = kontoZustand.speichern.laeuft,
            check = passwordCheck,
            changeOn = { onPassword(pwCurrent, pwNeu, code) },
        )
    }

    // Der Server bestätigt jede Profiländerung mit dem Passwort: Sonst liesse sich über
    // eine neue Adresse das Passwort zurücksetzen. Gefragt wird erst beim Speichern.
    if (asksPassword) PasswordPrompt(
        titel = stringResource(R.string.konto_save),
        text = stringResource(R.string.konto_profil_password_needed),
        bestaetigen = stringResource(R.string.konto_save),
        codeNoetig = false, fehler = null, laeuft = kontoZustand.speichern.laeuft,
        onBestaetigen = { pw, _ -> asksPassword = false; onSpeichern(benutzername, email, vorname, nachname, pw, code) },
        onAbbrechen = { asksPassword = false },
    )
}

/** Weicht eine Eingabe vom Stand des Servers ab? Nur dann lässt sich speichern. */
private fun profileChanged(profile: ProfileView?, benutzername: String, email: String, vorname: String, nachname: String) =
    profile != null && (
        benutzername != profile.username.orEmpty() || email != profile.email.orEmpty() ||
        vorname != profile.firstName.orEmpty() || nachname != profile.lastName.orEmpty())

/** Meldung und Fehler über den Profilfeldern, beide angesagt. */
@Composable
private fun AccountMessages(kontoZustand: AccountUiState) {
    kontoZustand.meldung?.let { meldung ->
        Text(meldung.satz(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary, modifier = Modifier.announce())
    }
    (kontoZustand.speichern.errorMessage ?: kontoZustand.abruf.errorMessage)?.let { ErrorRow(it) }
}

/** „Profil speichern“, antippbar auch ohne Änderung; dann sagt die Zeile darüber, warum nichts geschieht. */
@Composable
private fun ProfileSaveButton(nothingChanged: Boolean, speichert: Boolean, onClick: () -> Unit) {
    if (nothingChanged) Text(stringResource(R.string.konto_nichts_geaendert),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.announce())
    Button(
        onClick = onClick,
        enabled = !speichert,
        colors = mainButtonColors(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    ) { Text(stringResource(R.string.konto_save), fontWeight = FontWeight.SemiBold) }
}

/** Ein Profilfeld, das vor dem Speichern nicht leer sein darf. */
internal enum class ProfileField { BENUTZERNAME, EMAIL }

/** Was vor dem Speichern fehlt, in der Reihenfolge der Felder. */
internal fun profileError(benutzername: String, email: String): List<ProfileField> = buildList {
    if (benutzername.isBlank()) add(ProfileField.BENUTZERNAME)
    if (email.isBlank()) add(ProfileField.EMAIL)
}

/**
 * Benutzername, E-Mail und Name; den Zustand der Felder hält AccountCard. Mit Symbol wie
 * beim Registrieren und wie die Passwortfelder darunter: Ohne sahen die beiden Karten
 * aus zwei Formularen aus.
 */
@Composable
private fun ProfileFields(
    profile: ProfileView,
    fehler: List<ProfileField>,
    fokus: Map<ProfileField, FocusRequester>,
    benutzername: String,
    onUsername: (String) -> Unit,
    email: String,
    onEmail: (String) -> Unit,
    vorname: String,
    onFirstName: (String) -> Unit,
    nachname: String,
    onLastName: (String) -> Unit,
) {
    val ausstehend = profile.emailNew
    val nameMissing = ProfileField.BENUTZERNAME in fehler
    OutlinedTextField(
        value = benutzername,
        onValueChange = onUsername,
        label = { Text(stringResource(R.string.login_username)) },
        leadingIcon = { Icon(Icons.Default.Person, null) },
        isError = nameMissing,
        supportingText = if (nameMissing) { { Text(stringResource(R.string.login_username_fehlt), Modifier.announce()) } } else null,
        modifier = Modifier.fillMaxWidth().focusRequester(fokus.getValue(ProfileField.BENUTZERNAME)),
        singleLine = true, shape = Formen.feld)
    val emailMissing = ProfileField.EMAIL in fehler
    OutlinedTextField(
        value = email,
        onValueChange = onEmail,
        label = { Text(stringResource(R.string.register_email)) },
        leadingIcon = { Icon(Icons.Default.Email, null) },
        // Eine neue Adresse wartet auf ihren Link, das Feld zeigt bis dahin die
        // geltende. Ohne den Hinweis sähe die Änderung nach dem Speichern verloren aus.
        supportingText = when {
            emailMissing -> { { Text(stringResource(R.string.konto_email_fehlt), Modifier.announce()) } }
            ausstehend != null -> { { Text(stringResource(R.string.konto_email_ausstehend, ausstehend)) } }
            !profile.emailConfirmed -> { { Text(stringResource(R.string.konto_email_unverified)) } }
            else -> null
        },
        isError = emailMissing || !profile.emailConfirmed,
        modifier = Modifier.fillMaxWidth().focusRequester(fokus.getValue(ProfileField.EMAIL)),
        singleLine = true, shape = Formen.feld,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    OutlinedTextField(
        value = vorname, onValueChange = onFirstName,
        label = { Text(stringResource(R.string.register_first_name)) },
        leadingIcon = { Icon(Icons.Default.Badge, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld)
    OutlinedTextField(
        value = nachname, onValueChange = onLastName,
        label = { Text(stringResource(R.string.register_last_name)) },
        leadingIcon = { Icon(Icons.Default.Badge, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld)
}

/** Passwort ändern. Die Eingaben hält AccountCard; die Karte zeigt sie nur und meldet Änderungen. */
@Composable
private fun PasswordCard(
    pwCurrent: String,
    onPwCurrent: (String) -> Unit,
    pwNeu: String,
    onPwNew: (String) -> Unit,
    pwRepeated: String,
    onPwRepeated: (String) -> Unit,
    speichert: Boolean,
    check: PasswordSwitchCheck,
    changeOn: () -> Unit,
) {
    SettingsCard(title = stringResource(R.string.konto_password_title), icon = Icons.Default.Lock) {
        // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
        // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
        Text(stringResource(R.string.konto_password_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        val fokus = LocalFocusManager.current
        PasswordSwitchFields(pwCurrent, onPwCurrent, pwNeu, onPwNew, pwRepeated, onPwRepeated, check,
            KeyboardActions(onNext = { fokus.moveFocus(FocusDirection.Down) }))
        // Tonal statt umrandet: Ein deaktivierter umrandeter Knopf war kaum zu sehen.
        FilledTonalButton(
            onClick = { check.submit(pwCurrent, pwNeu, pwRepeated, changeOn) },
            enabled = !speichert,
            colors = toneButtonColors(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
    }
}

/**
 * Das Design dieses Kontos: die Vorgabe des Verwalters oder ein eigenes. Es gilt
 * auf allen Geräten des Kontos, weil der Server es speichert; ohne [design]
 * (älterer Server) bleibt die Karte weg.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DesignCard(design: DesignChoice?, onWahl: (Design?) -> Unit) {
    if (design == null) return
    SettingsCard(title = stringResource(R.string.monitoring_theme), icon = Icons.Default.Palette) {
        Text(stringResource(R.string.konto_design_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Eine Wahl aus sieben: ein Feld mit Menü wie Sprache und Währung; null steht für
        // „die Vorgabe des Servers“.
        val vorgabe = stringResource(design.vorgabe.titel())
        SelectionField(
            beschriftung = stringResource(R.string.monitoring_theme),
            modifier = Modifier.fillMaxWidth(),
            optionen = listOf<Pair<Design?, String>>(null to stringResource(R.string.konto_design_vorgabe, vorgabe)) +
                Design.entries.map { it to stringResource(it.titel()) },
            gewaehlt = design.eigenes,
            onWahl = { wert -> if (wert != design.eigenes) onWahl(wert) },
        )
        // Was das gewählte Design ausmacht — Werkbank allein am Bild vom dunklen Classic zu
        // unterscheiden, gelang kaum.
        (design.eigenes ?: design.vorgabe).beschreibung().let {
            Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
