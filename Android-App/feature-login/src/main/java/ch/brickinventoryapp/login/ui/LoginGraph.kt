package ch.brickinventoryapp.login.ui

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.QrAccountQuestion
import ch.brickinventoryapp.login.ui.screens.ServerStartDisplay
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.login.ui.viewmodel.LoginViewModel

/** What sign-in needs from the app: only the app knows where it goes after signing in. */
interface LoginNavigation {
    val navController: NavHostController

    /** Sign-in succeeded; the sign-in destinations leave the stack. */
    fun loggedIn()
}

/**
 * Setup and sign-in as their own subgraph ([LoginTarget.Area]): a
 * QR sign-in begins in setup and continues after switching to sign-in.
 * The ViewModel is therefore tied to the subgraph's entry and ends with it.
 * [begin] is setup or sign-in.
 */
fun NavGraphBuilder.loginGraph(navigation: LoginNavigation, begin: LoginTarget) {
    navigation<LoginTarget.Area>(startDestination = begin) {
        setupTarget(navigation.navController)
        loginTarget(navigation)
    }
}

/** The subgraph's ViewModel, bound to its entry. */
@Composable
private fun loginViewModel(navController: NavHostController, entry: NavBackStackEntry): LoginViewModel {
    val area = remember(entry) { navController.getBackStackEntry<LoginTarget.Area>() }
    return hiltViewModel(area)
}

/** Enter the server address or take it over via QR code. */
private fun NavGraphBuilder.setupTarget(navController: NavHostController) {
    composable<LoginTarget.Setup> { entry ->
        val loginVm = loginViewModel(navController, entry)
        val state by loginVm.state.collectAsStateWithLifecycle()
        SetupScreen(
            currentUrl = state.serverUrl,
            // A different server signs out via the app's full path, before the
            // new address takes effect (LoginViewModel.saveServerUrl).
            onSave = { url ->
                if (loginVm.saveServerUrl(url)) {
                    navController.navigate(LoginTarget.Login) {
                        popUpTo<LoginTarget.Setup> { inclusive = true }
                    }
                }
            },
            // Only after the confirmation in the setup screen; sign-in
            // jumps to the gallery on success.
            onQrScanned = { qr, pinInput ->
                // The device name appears in the browser at the question „Gerät koppeln?“.
                loginVm.loginWithQrToken(qr.url, qr.token, fingerprint = qr.fingerprint,
                    pinSwitchInput = pinInput, device = Build.MODEL.orEmpty().ifBlank { "Android App" })
                navController.navigate(LoginTarget.Login) {
                    popUpTo<LoginTarget.Setup> { inclusive = true }
                }
            },
            previousPin = loginVm::previousPin,
            mustTypeIn = loginVm::mustTypeIn,
        )
    }
}

/** Sign in, register and passkey; while the server is starting, its progress. */
private fun NavGraphBuilder.loginTarget(navigation: LoginNavigation) {
    val navController = navigation.navController
    composable<LoginTarget.Login> { entry ->
        val loginVm = loginViewModel(navController, entry)
        val state by loginVm.state.collectAsStateWithLifecycle()
        val loginUiState by loginVm.loginState.collectAsStateWithLifecycle()
        val activity = LocalContext.current
        val passkeys = remember(activity) { CredentialManagerQuery(activity) }
        // Once on entering: is registration even open?
        // Reachable without signing in — the question does come before there
        // is an account. `Unit` as the key: exactly once per setup, not
        // on every state change.
        LaunchedEffect(Unit) { loginVm.openCheckRegistration() }
        // If the server is currently starting, the progress stands in place of the form: a
        // network message would sound like an error. `startupStatus` only has a value
        // when the server answers and denies `ready`.
        val serverStart = state.startupStatus
        if (serverStart != null) {
            ServerStartDisplay(serverStart)
        } else LoginScreen(
            state = LoginScreenState(
                serverUrl = state.serverUrl,
                login = loginUiState.login,
                qrConfirmation = loginUiState.qrConfirmation,
                codeNeeded = loginUiState.codeNeeded,
                form = loginUiState.form,
                registrationOpen = loginUiState.registrationOpen,
                account = loginUiState.account,
                message = loginUiState.message,
                hint = loginUiState.hint,
                fullAccess = loginUiState.fullAccess,
                passkeyInsteadOfCode = loginUiState.passkeyInsteadOfCode,
            ),
            actions = remember(loginVm, passkeys) { GraphLoginActions(loginVm, passkeys, navController) },
        )
        loginUiState.qrAccount?.let { QrAccountQuestion(it, loginVm::decideQrAccount) }
        // Outside the if/else: if someone signs in while the server
        // is still starting — possible, because the switch can happen at any time —,
        // the jump to the gallery should happen anyway.
        LaunchedEffect(state.isLoggedIn) {
            if (state.isLoggedIn) navigation.loggedIn()
        }
    }
}

/** The sign-in screen's actions on the ViewModel; the passkey query is tied to the Activity (system picker). */
private class GraphLoginActions(
    private val loginVm: LoginViewModel,
    private val passkeys: CredentialManagerQuery,
    private val navController: NavHostController,
) : LoginActions {
    override fun login(username: String, password: String, code: String?) = loginVm.login(username, password, code)
    override fun showForm(form: LoginForm) = loginVm.showLoginForm(form)
    override fun register(username: String, email: String, firstName: String, lastName: String, password: String) =
        loginVm.register(username, email, firstName, lastName, password)
    override fun forgotPassword(email: String) = loginVm.passwordForget(email)
    override fun setFullAccess(on: Boolean) = loginVm.setFullAccess(on)
    override val offersPasskey get() = true
    override fun loginPasskey() = loginVm.loginPasskey(passkeys)
    override fun passkeyInsteadOfCode(username: String, password: String) =
        loginVm.passkeyInsteadOfCode(username, password, passkeys)
    override fun changeServer() {
        navController.navigate(LoginTarget.Setup) {
            popUpTo<LoginTarget.Login> { inclusive = true }
        }
    }
}
