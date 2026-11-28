package ch.brickinventoryapp.login.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.QrAccount
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.KeyboardWithoutLearn
import ch.brickinventoryapp.ui.components.LoginCard
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.windowSurface
import ch.brickinventoryapp.uistate.Operation
import ch.brickinventoryapp.uistate.errorMessage
import ch.brickinventoryapp.uistate.running

/** What the sign-in screen shows; LoginGraph fills it from the session and LoginUiState. The screen forms the sentences. */
data class LoginScreenState(
    val serverUrl: String,
    val form: LoginForm = LoginForm.LOGIN,
    val login: Operation = Operation.Done,
    val codeNeeded: Boolean = false,
    val registrationOpen: Boolean? = null,
    val account: Operation = Operation.Done,
    /** Success message and hint after register or reset; they stand together below the form. */
    val message: Message? = null,
    val hint: Message? = null,
    val fullAccess: Boolean = false,
    val passkeyInsteadOfCode: Boolean = false,
    /** After a QR scan: the code one types into the browser. */
    val qrConfirmation: String? = null,
)

/** What the sign-in screen can trigger; every action does nothing unless overridden (preview, test). */
interface LoginActions {
    fun login(username: String, password: String, code: String?) = Unit
    fun showForm(form: LoginForm) = Unit
    fun register(username: String, email: String, firstName: String, lastName: String, password: String) = Unit
    fun forgotPassword(email: String) = Unit
    fun changeServer() = Unit
    fun setFullAccess(on: Boolean) = Unit
    /** false: no passkey button (for instance in preview and test). */
    val offersPasskey: Boolean get() = false
    fun loginPasskey() = Unit
    fun passkeyInsteadOfCode(username: String, password: String) = Unit
}

/**
 * Sign in, create an account, request a reset link — like the web app. Three
 * forms in one screen, so that the back button means "back to sign-in".
 * The web UI sets the new password: intercepting the link would need
 * an intent filter on an address that everyone sets themselves.
 */
@Composable
fun LoginScreen(state: LoginScreenState, actions: LoginActions) {
    // A planted tap can sign in here or confirm a passkey. The
    // visual protection for a revealed password is brought along by the PasswordField itself.
    OverlayGuard()

    // The keyboard does not learn password, code or address. In landscape, brand and form
    // sit side by side as during setup, otherwise „Registrieren“ was below the fold.
    KeyboardWithoutLearn {
        TwoPartLayout(
            partPadding = Spacing.large,
            singlePadding = PaddingValues(horizontal = 28.dp, vertical = Spacing.large),
            header = { LoginHeader(state.serverUrl, state.qrConfirmation, actions::changeServer) },
        ) { wide ->
            if (!wide) Spacer(Modifier.height(28.dp))
            LoginFormCard(state, actions, wide)
        }
    }
}

/** The same header as during setup, which comes right before this, with the server chip. */
@Composable
private fun LoginHeader(serverUrl: String, qrConfirmation: String?, onChangeServer: () -> Unit) {
    BrandsHeader()
    Spacer(Modifier.height(Spacing.medium))

    // The chip switches the server: TalkBack names that along with the address (the surface
    // combines the description with its role „Schaltfläche“). The address wraps
    // instead of being truncated: it is exactly what one checks before signing in.
    val changeServer = stringResource(R.string.login_server_edit, serverUrl)
    Surface(
        onClick = onChangeServer,
        // Surface(onClick) sets no role: TalkBack would otherwise only read the address.
        modifier = Modifier.semantics {
            role = Role.Button
            contentDescription = changeServer
        },
        shape = Shapes.chip,
        color = MaterialTheme.colorScheme.surface,
        // outline: the border is the chip's only boundary and needs 3:1.
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.heightIn(min = 32.dp).padding(horizontal = Spacing.small, vertical = Spacing.tiny),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
            Icon(Icons.Default.Cloud, null, Modifier.size(withFont(16.dp)),
                tint = MaterialTheme.colorScheme.primary)
            Text(serverUrl, Modifier.weight(1f, fill = false),
                style = MaterialTheme.typography.labelMedium)
            Icon(Icons.Default.Edit, null, Modifier.size(withFont(16.dp)),
                tint = MaterialTheme.colorScheme.primary)
        }
    }
    if (qrConfirmation != null) {
        Spacer(Modifier.height(Spacing.medium))
        Text(stringResource(R.string.login_qr_confirm_hint), style = MaterialTheme.typography.bodyMedium)
        Text(qrConfirmation.chunked(3).joinToString(" "), Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.headlineMedium)
    }
}

/** The card with the current form; name, password and code live here, not in the ViewModel. */
@Composable
private fun LoginFormCard(state: LoginScreenState, actions: LoginActions, wide: Boolean) {
    var username by rememberSaveable { mutableStateOf("") }
    // remember, not rememberSaveable: saved state ends up in the bundle and on a
    // process death on disk (ActivityManager) — no place for passwords and codes.
    var password by remember { mutableStateOf("") }
    var code     by remember { mutableStateOf("") }
    val focusMgr = LocalFocusManager.current
    val accountMessage = listOfNotNull(state.message?.sentence(), state.hint?.sentence()).joinToString(" ").ifEmpty { null }
    val accountError = state.account.errorMessage?.sentence()
    LoginCard {
        when (state.form) {
            LoginForm.LOGIN -> LoginFields(
                state = state, actions = actions,
                input = LoginInput(username, password, code),
                onInput = { username = it.username; password = it.password; code = it.code },
                focusMgr = focusMgr)

            LoginForm.REGISTER -> RegisterFields(
                running = state.account.running, message = accountMessage, error = accountError,
                focusMgr = focusMgr, namesSideBySide = wide,
                onRegister = actions::register, onForm = actions::showForm)

            LoginForm.FORGOT_PASSWORD -> ForgotPasswordFields(
                running = state.account.running, message = accountMessage, error = accountError,
                sendOn = actions::forgotPassword, onForm = actions::showForm)
        }
    }
}

/**
 * Which account on which server the code signs in to, before the app
 * takes over the access: a planted code would otherwise silently sign in to someone
 * else's account, and everything entered would end up there. Tapping away means no.
 */
@Composable
internal fun QrAccountQuestion(account: QrAccount, onQrAccount: (adopt: Boolean) -> Unit) {
    val title = stringResource(R.string.login_qr_account_title)
    AlertDialog(
        containerColor = windowSurface(),
        onDismissRequest = { onQrAccount(false) },
        modifier = Modifier.semantics { paneTitle = title },
        title = { Text(title, Modifier.semantics { heading() }) },
        text = {
            OverlayGuard()
            Text(stringResource(R.string.login_qr_account_text, account.user, account.server))
        },
        confirmButton = {
            TextButton(onClick = { onQrAccount(true) }) { Text(stringResource(R.string.login_qr_account_yes)) }
        },
        dismissButton = {
            TextButton(onClick = { onQrAccount(false) }) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * A persistent message in the form — error red, confirmation calm. One version
 * for sign-in, register and forgot, so that spacing and border shape stay the
 * same everywhere.
 */
@Composable
internal fun FormMessage(text: String, error: Boolean) {
    Surface(
        shape = Shapes.tile,
        color = if (error) MaterialTheme.colorScheme.errorContainer
                else MaterialTheme.colorScheme.secondaryContainer
    ) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (error) Icons.Default.Warning else Icons.Default.CheckCircle, null,
                Modifier.size(16.dp),
                tint = if (error) MaterialTheme.colorScheme.onErrorContainer
                       else MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text,
                // Announced: after „Anmelden“ a blind person otherwise heard nothing.
                modifier = Modifier.announce(),
                color = if (error) MaterialTheme.colorScheme.onErrorContainer
                        else MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

/** A button that loads: a spinner instead of a label while something is running. */
@Composable
internal fun LoadButton(text: String, running: Boolean, active: Boolean, missing: String? = null, onClick: () -> Unit) {
    // A disabled main button says what is missing: pale alone left one guessing why.
    if (!active && !running && missing != null) Text(missing, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        enabled = !running && active
    ) {
        if (running) {
            CircularProgressIndicator(Modifier.size(18.dp),
                color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        } else {
            Text(text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        }
    }
}
