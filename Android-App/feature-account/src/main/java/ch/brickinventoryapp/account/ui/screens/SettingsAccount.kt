package ch.brickinventoryapp.account.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.DesignChoice
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.PasswordSwitchCheck
import ch.brickinventoryapp.ui.components.PasswordSwitchFields
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.rememberPasswordSwitchCheck
import ch.brickinventoryapp.ui.description
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.mainButtonColors
import ch.brickinventoryapp.ui.theme.toneButtonColors
import ch.brickinventoryapp.ui.title

/**
 * One's own account: profile and password. Via /auth/profile and
 * /auth/change-password, which also accept the app's bearer token.
 */
@Composable
internal fun AccountCard(
    // `accountUiState`, not `condition`: the account pages already use `condition` for other
    // states, and the same name for two types gets confusing to read.
    accountUiState: AccountUiState,
    onSave: (String, String, String, String) -> Unit,
    /** The new password; the login is enough, the current one isn't asked. */
    onPassword: (String) -> Unit,
    onMessageRoute: () -> Unit,
) {
    val profile = accountUiState.profile
    // The fields are pre-filled from the server state and then driven by the user.
    // `remember(profile)`, not `remember`: after saving, the ViewModel fetches
    // the profile again, and the fields should show the server's
    // NORMALIZED state, not what was typed.
    val draft = remember(profile) { ProfileDraft(profile) }
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for passwords.
    val passwords = remember { PasswordDraft() }

    val changed = profileChanged(profile, draft.username, draft.email, draft.firstName, draft.lastName)
    // Save stays tappable and then marks what's missing (as with the set dialog).
    var profileChecked by rememberSaveable(profile) { mutableStateOf(false) }
    val profileFocus = remember { ProfileField.entries.associateWith { FocusRequester() } }
    val passwordCheck = rememberPasswordSwitchCheck()

    // "Profile", not "Account": the page's bar is already named that.
    SettingsCard(title = stringResource(R.string.account_profile_title), icon = Icons.Default.AccountCircle) {
        if (accountUiState.fetch.loading && profile == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        AccountMessages(accountUiState)

        if (profile != null) {
            ProfileFields(profile,
                error = if (profileChecked) profileError(draft.username, draft.email) else emptyList(),
                focus = profileFocus,
                draft = draft, onEdit = onMessageRoute)
            ProfileSaveButton(nothingChanged = profileChecked && !changed, saves = accountUiState.save.running) {
                profileChecked = true
                val first = profileError(draft.username, draft.email).firstOrNull()
                if (first != null) profileFocus.getValue(first).requestFocus()
                else if (changed) onSave(draft.username, draft.email, draft.firstName, draft.lastName)
            }
        }
    }

    // Its own card under its own heading: under "Profile" the password read
    // as part of the data that "Save profile" secures.
    if (profile != null) {
        PasswordCard(
            passwords = passwords,
            saves = accountUiState.save.running,
            check = passwordCheck,
            changeOn = { onPassword(passwords.new) },
        )
    }
}

/**
 * The profile fields while editing: pre-filled from the server state, then driven by the user.
 * Created anew per profile, so that after saving the fields show the server's NORMALIZED state.
 */
private class ProfileDraft(profile: ProfileView?) {
    var username by mutableStateOf(profile?.username.orEmpty())
    var email by mutableStateOf(profile?.email.orEmpty())
    var firstName by mutableStateOf(profile?.firstName.orEmpty())
    var lastName by mutableStateOf(profile?.lastName.orEmpty())
}

/** New and repeated password; only in memory, never in the saved state. */
private class PasswordDraft {
    var new by mutableStateOf("")
    var repeated by mutableStateOf("")
}

/** Does an input differ from the server's state? Only then can it be saved. */
private fun profileChanged(profile: ProfileView?, username: String, email: String, firstName: String, lastName: String) =
    profile != null && (
        username != profile.username.orEmpty() || email != profile.email.orEmpty() ||
        firstName != profile.firstName.orEmpty() || lastName != profile.lastName.orEmpty())

/** Message and error above the profile fields, both announced. */
@Composable
private fun AccountMessages(accountUiState: AccountUiState) {
    accountUiState.message?.let { message ->
        Text(message.sentence(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary, modifier = Modifier.announce())
    }
    (accountUiState.save.errorMessage ?: accountUiState.fetch.errorMessage)?.let { ErrorRow(it) }
}

/** "Save profile", tappable even without a change; then the line above says why nothing happens. */
@Composable
private fun ProfileSaveButton(nothingChanged: Boolean, saves: Boolean, onClick: () -> Unit) {
    if (nothingChanged) Text(stringResource(R.string.account_nothing_changed),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.announce())
    Button(
        onClick = onClick,
        enabled = !saves,
        colors = mainButtonColors(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    ) { Text(stringResource(R.string.account_save), fontWeight = FontWeight.SemiBold) }
}

/** A profile field that must not be empty before saving. */
internal enum class ProfileField { USERNAME, EMAIL }

/** What's missing before saving, in the order of the fields. */
internal fun profileError(username: String, email: String): List<ProfileField> = buildList {
    if (username.isBlank()) add(ProfileField.USERNAME)
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
    error: List<ProfileField>,
    focus: Map<ProfileField, FocusRequester>,
    draft: ProfileDraft,
    /** Every keystroke clears the message about the last save. */
    onEdit: () -> Unit,
) {
    val pending = profile.emailNew
    val nameMissing = ProfileField.USERNAME in error
    OutlinedTextField(
        value = draft.username,
        onValueChange = { draft.username = it; onEdit() },
        label = { Text(stringResource(R.string.login_username)) },
        leadingIcon = { Icon(Icons.Default.Person, null) },
        isError = nameMissing,
        supportingText = if (nameMissing) { { Text(stringResource(R.string.login_username_missing), Modifier.announce()) } } else null,
        modifier = Modifier.fillMaxWidth().focusRequester(focus.getValue(ProfileField.USERNAME)),
        singleLine = true, shape = Shapes.field)
    val emailMissing = ProfileField.EMAIL in error
    OutlinedTextField(
        value = draft.email,
        onValueChange = { draft.email = it; onEdit() },
        label = { Text(stringResource(R.string.register_email)) },
        leadingIcon = { Icon(Icons.Default.Email, null) },
        // A new address is waiting for its confirmation link, the field shows the
        // current one until then. Without the hint, the change would look lost after saving.
        supportingText = when {
            emailMissing -> { { Text(stringResource(R.string.account_email_missing), Modifier.announce()) } }
            pending != null -> { { Text(stringResource(R.string.account_email_pending, pending)) } }
            !profile.emailConfirmed -> { { Text(stringResource(R.string.account_email_unverified)) } }
            else -> null
        },
        isError = emailMissing || !profile.emailConfirmed,
        modifier = Modifier.fillMaxWidth().focusRequester(focus.getValue(ProfileField.EMAIL)),
        singleLine = true, shape = Shapes.field,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    OutlinedTextField(
        value = draft.firstName, onValueChange = { draft.firstName = it; onEdit() },
        label = { Text(stringResource(R.string.register_first_name)) },
        leadingIcon = { Icon(Icons.Default.Badge, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Shapes.field)
    OutlinedTextField(
        value = draft.lastName, onValueChange = { draft.lastName = it; onEdit() },
        label = { Text(stringResource(R.string.register_last_name)) },
        leadingIcon = { Icon(Icons.Default.Badge, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Shapes.field)
}

/** Change password. AccountCard holds the inputs; the card only displays them and reports changes. */
@Composable
private fun PasswordCard(
    passwords: PasswordDraft,
    saves: Boolean,
    check: PasswordSwitchCheck,
    changeOn: () -> Unit,
) {
    SettingsCard(title = stringResource(R.string.account_password_title), icon = Icons.Default.Lock) {
        // Sits BEFORE the fields, not below them: whoever only finds out after
        // typing that it signs them out has already typed.
        Text(stringResource(R.string.account_password_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        val focus = LocalFocusManager.current
        PasswordSwitchFields(null, {}, passwords.new, { passwords.new = it },
            passwords.repeated, { passwords.repeated = it }, check,
            KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
        // Tonal instead of outlined: a disabled outlined button was barely visible.
        FilledTonalButton(
            onClick = { check.submit(null, passwords.new, passwords.repeated, changeOn) },
            enabled = !saves,
            colors = toneButtonColors(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        ) { Text(stringResource(R.string.account_password_button), fontWeight = FontWeight.SemiBold) }
    }
}

/**
 * This account's design: the admin's default or one of its own. It applies
 * on all of the account's devices, because the server stores it; without [design]
 * (older server) the card stays off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DesignCard(design: DesignChoice?, onChoice: (Design?) -> Unit) {
    if (design == null) return
    SettingsCard(title = stringResource(R.string.monitoring_theme), icon = Icons.Default.Palette) {
        Text(stringResource(R.string.account_design_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // A choice of seven: a field with a menu like language and currency; null stands for
        // "the server's default".
        val default = stringResource(design.default.title())
        SelectionField(
            label = stringResource(R.string.monitoring_theme),
            modifier = Modifier.fillMaxWidth(),
            options = listOf<Pair<Design?, String>>(null to stringResource(R.string.account_design_default, default)) +
                Design.entries.map { it to stringResource(it.title()) },
            chosen = design.own,
            onChoice = { value -> if (value != design.own) onChoice(value) },
        )
        // What defines the chosen design — telling `werkbank` apart from the dark classic
        // image alone was hardly possible.
        (design.own ?: design.default).description().let {
            Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
