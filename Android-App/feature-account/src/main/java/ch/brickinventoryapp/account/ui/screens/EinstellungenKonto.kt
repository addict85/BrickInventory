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
 * One's own account: profile and password. Via /auth/profile and
 * /auth/change-password, which also accept the app's bearer token.
 */
@Composable
internal fun AccountCard(
    // `kontoZustand`, not `zustand`: the account pages already use `zustand` for other
    // states, and the same name for two types gets confusing to read.
    kontoZustand: AccountUiState,
    onSpeichern: (String, String, String, String, String?, String?) -> Unit,
    onPassword: (String, String, String?) -> Unit,
    onMessageRoute: () -> Unit,
) {
    val profile = kontoZustand.profile
    // The fields are pre-filled from the server state and then driven by the user.
    // `remember(profile)`, not `remember`: after saving, the ViewModel fetches
    // the profile again, and the fields should show the server's
    // NORMALIZED state, not what was typed.
    var benutzername by remember(profile) { mutableStateOf(profile?.username.orEmpty()) }
    var email        by remember(profile) { mutableStateOf(profile?.email.orEmpty()) }
    var vorname      by remember(profile) { mutableStateOf(profile?.firstName.orEmpty()) }
    var nachname     by remember(profile) { mutableStateOf(profile?.lastName.orEmpty()) }
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for passwords and codes.
    var pwCurrent    by remember { mutableStateOf("") }
    var pwNeu        by remember { mutableStateOf("") }
    var pwRepeated by remember { mutableStateOf("") }
    // The password for a profile change is only asked by the dialog on save.
    var asksPassword by remember(profile) { mutableStateOf(false) }
    var faktorCode   by remember { mutableStateOf("") }
    val code = faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() }

    val geaendert = profileChanged(profile, benutzername, email, vorname, nachname)
    // Save stays tappable and then marks what's missing (as with the set dialog).
    var profileChecked by rememberSaveable(profile) { mutableStateOf(false) }
    val profileFocus = remember { ProfileField.entries.associateWith { FocusRequester() } }
    val passwordCheck = rememberPasswordSwitchCheck()

    // "Profile", not "Account": the page's bar is already named that.
    SettingsCard(title = stringResource(R.string.konto_profil_titel), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.abruf.laedt && profile == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        AccountMessages(kontoZustand)
        // Only after the server has demanded it; applies to email and password.
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
            // Give up focus first: otherwise the last-typed field stays focused behind the
            // dialog and keeps the keyboard and cursor, even though only the dialog
            // accepts input.
            val fokus = LocalFocusManager.current
            ProfileSaveButton(nothingChanged = profileChecked && !geaendert, speichert = kontoZustand.speichern.laeuft) {
                profileChecked = true
                val erstes = profileError(benutzername, email).firstOrNull()
                if (erstes != null) profileFocus.getValue(erstes).requestFocus()
                else if (geaendert) { fokus.clearFocus(); asksPassword = true }
            }
        }
    }

    // Its own card under its own heading: under "Profile" the password read
    // as part of the data that "Save profile" secures.
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

    // The server confirms every profile change with the password: otherwise the
    // password could be reset via a new address. It's only asked on save.
    if (asksPassword) PasswordPrompt(
        titel = stringResource(R.string.konto_save),
        text = stringResource(R.string.konto_profil_password_needed),
        bestaetigen = stringResource(R.string.konto_save),
        codeNoetig = false, fehler = null, laeuft = kontoZustand.speichern.laeuft,
        onBestaetigen = { pw, _ -> asksPassword = false; onSpeichern(benutzername, email, vorname, nachname, pw, code) },
        onAbbrechen = { asksPassword = false },
    )
}

/** Does an input differ from the server's state? Only then can it be saved. */
private fun profileChanged(profile: ProfileView?, benutzername: String, email: String, vorname: String, nachname: String) =
    profile != null && (
        benutzername != profile.username.orEmpty() || email != profile.email.orEmpty() ||
        vorname != profile.firstName.orEmpty() || nachname != profile.lastName.orEmpty())

/** Message and error above the profile fields, both announced. */
@Composable
private fun AccountMessages(kontoZustand: AccountUiState) {
    kontoZustand.meldung?.let { meldung ->
        Text(meldung.satz(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary, modifier = Modifier.announce())
    }
    (kontoZustand.speichern.errorMessage ?: kontoZustand.abruf.errorMessage)?.let { ErrorRow(it) }
}

/** "Save profile", tappable even without a change; then the line above says why nothing happens. */
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

/** A profile field that must not be empty before saving. */
internal enum class ProfileField { BENUTZERNAME, EMAIL }

/** What's missing before saving, in the order of the fields. */
internal fun profileError(benutzername: String, email: String): List<ProfileField> = buildList {
    if (benutzername.isBlank()) add(ProfileField.BENUTZERNAME)
    if (email.isBlank()) add(ProfileField.EMAIL)
}

/**
 * Username, email and name; AccountCard holds the fields' state. With an icon as
 * at registration and like the password fields below: without it the two cards looked
 * like two different forms.
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
        // A new address is waiting for its confirmation link, the field shows the
        // current one until then. Without the hint, the change would look lost after saving.
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

/** Change password. AccountCard holds the inputs; the card only displays them and reports changes. */
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
        // Sits BEFORE the fields, not below them: whoever only finds out after
        // typing that it signs them out has already typed.
        Text(stringResource(R.string.konto_password_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        val fokus = LocalFocusManager.current
        PasswordSwitchFields(pwCurrent, onPwCurrent, pwNeu, onPwNew, pwRepeated, onPwRepeated, check,
            KeyboardActions(onNext = { fokus.moveFocus(FocusDirection.Down) }))
        // Tonal instead of outlined: a disabled outlined button was barely visible.
        FilledTonalButton(
            onClick = { check.submit(pwCurrent, pwNeu, pwRepeated, changeOn) },
            enabled = !speichert,
            colors = toneButtonColors(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
    }
}

/**
 * This account's design: the admin's default or one of its own. It applies
 * on all of the account's devices, because the server stores it; without [design]
 * (older server) the card stays off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DesignCard(design: DesignChoice?, onWahl: (Design?) -> Unit) {
    if (design == null) return
    SettingsCard(title = stringResource(R.string.monitoring_theme), icon = Icons.Default.Palette) {
        Text(stringResource(R.string.konto_design_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // A choice of seven: a field with a menu like language and currency; null stands for
        // "the server's default".
        val vorgabe = stringResource(design.vorgabe.titel())
        SelectionField(
            beschriftung = stringResource(R.string.monitoring_theme),
            modifier = Modifier.fillMaxWidth(),
            optionen = listOf<Pair<Design?, String>>(null to stringResource(R.string.konto_design_vorgabe, vorgabe)) +
                Design.entries.map { it to stringResource(it.titel()) },
            gewaehlt = design.eigenes,
            onWahl = { wert -> if (wert != design.eigenes) onWahl(wert) },
        )
        // What defines the chosen design — telling werkbank apart from the dark classic
        // image alone was hardly possible.
        (design.eigenes ?: design.vorgabe).beschreibung().let {
            Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
