package ch.brickinventoryapp.login.ui

import androidx.compose.runtime.getValue
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.ui.satz
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.QrAccountQuestion
import ch.brickinventoryapp.login.ui.screens.ServerStartAnzeige
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.login.ui.viewmodel.AnmeldungViewModel

/** What sign-in needs from the app: only the app knows where it goes after signing in. */
interface LoginNavigation {
    val navController: NavHostController

    /** Sign-in succeeded; the sign-in destinations leave the stack. */
    fun angemeldet()
}

/**
 * Setup and sign-in as their own subgraph ([LoginTarget.Bereich]): a
 * QR sign-in begins in setup and continues after switching to sign-in.
 * The ViewModel is therefore tied to the subgraph's entry and ends with it.
 * [beginn] is setup or sign-in.
 */
fun NavGraphBuilder.loginGraph(navigation: LoginNavigation, beginn: LoginTarget) {
    navigation<LoginTarget.Bereich>(startDestination = beginn) {
        setupTarget(navigation.navController)
        loginTarget(navigation)
    }
}

/** The subgraph's ViewModel, bound to its entry. */
@Composable
private fun loginViewModel(navController: NavHostController, entry: NavBackStackEntry): AnmeldungViewModel {
    val bereich = remember(entry) { navController.getBackStackEntry<LoginTarget.Bereich>() }
    return hiltViewModel(bereich)
}

/** Enter the server address or take it over via QR code. */
private fun NavGraphBuilder.setupTarget(navController: NavHostController) {
    composable<LoginTarget.Setup> { entry ->
        val loginVm = loginViewModel(navController, entry)
        val state by loginVm.state.collectAsStateWithLifecycle()
        SetupScreen(
            currentUrl = state.serverUrl,
            // A different server signs out via the app's full path, before the
            // new address takes effect (AnmeldungViewModel.saveServerUrl).
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
                loginVm.loginWithQrToken(qr.url, qr.token, fingerabdruck = qr.fingerabdruck,
                    pinSwitchInput = pinInput, geraet = Build.MODEL.orEmpty().ifBlank { "Android App" })
                navController.navigate(LoginTarget.Login) {
                    popUpTo<LoginTarget.Setup> { inclusive = true }
                }
            },
            bisherigerPin = loginVm::bisherigerPin,
            mussAbtippen = loginVm::mussAbtippen,
        )
    }
}

/** Sign in, register and passkey; while the server is starting, its progress. */
private fun NavGraphBuilder.loginTarget(navigation: LoginNavigation) {
    val navController = navigation.navController
    composable<LoginTarget.Login> { entry ->
        val loginVm = loginViewModel(navController, entry)
        val state by loginVm.state.collectAsStateWithLifecycle()
        val anmeldeZustand by loginVm.anmeldeState.collectAsStateWithLifecycle()
        val aktivitaet = LocalContext.current
        val passkeys = remember(aktivitaet) { CredentialManagerQuery(aktivitaet) }
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
            ServerStartAnzeige(serverStart)
        } else LoginScreen(
            serverUrl = state.serverUrl,
            isLoading = anmeldeZustand.anmeldung.laeuft,
            error = anmeldeZustand.anmeldung.errorMessage?.satz(),
            qrBestaetigung = anmeldeZustand.qrBestaetigung,
            codeNoetig = anmeldeZustand.codeNoetig,
            formular = anmeldeZustand.formular,
            registrierungOffen = anmeldeZustand.registrierungOffen,
            kontoLaeuft = anmeldeZustand.konto.laeuft,
            kontoMeldung = listOfNotNull(anmeldeZustand.meldung?.satz(), anmeldeZustand.hinweis?.satz())
                .joinToString(" ").ifEmpty { null },
            kontoFehler = anmeldeZustand.konto.errorMessage?.satz(),
            onLogin = { user, pw, code -> loginVm.login(user, pw, code) },
            vollerZugriff = anmeldeZustand.vollerZugriff,
            onVollerZugriff = { loginVm.setFullAccess(it) },
            // The query is tied to the Activity (the system's picker dialog); the ViewModel lives longer.
            onPasskey = { loginVm.signInPasskey(passkeys) },
            passkeyStattCode = anmeldeZustand.passkeyStattCode,
            onPasskeyStattCode = { user, pw -> loginVm.passkeyStattCode(user, pw, passkeys) },
            onFormular = { loginVm.showLoginForm(it) },
            onRegistrieren = { u, e, v, n, pw -> loginVm.registriere(u, e, v, n, pw) },
            onPasswortVergessen = { loginVm.passwortVergessen(it) },
            onChangeServer = {
                navController.navigate(LoginTarget.Setup) {
                    popUpTo<LoginTarget.Login> { inclusive = true }
                }
            }
        )
        anmeldeZustand.qrAccount?.let { QrAccountQuestion(it, loginVm::decideQrAccount) }
        // Outside the if/else: if someone signs in while the server
        // is still starting — possible, because the switch can happen at any time —,
        // the jump to the gallery should happen anyway.
        LaunchedEffect(state.isLoggedIn) {
            if (state.isLoggedIn) navigation.angemeldet()
        }
    }
}
