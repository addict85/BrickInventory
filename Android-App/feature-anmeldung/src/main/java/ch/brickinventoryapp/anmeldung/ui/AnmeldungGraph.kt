package ch.brickinventoryapp.anmeldung.ui

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
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.anmeldung.ui.screens.QrAccountQuestion
import ch.brickinventoryapp.anmeldung.ui.screens.ServerStartAnzeige
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.anmeldung.ui.viewmodel.AnmeldungViewModel

/** Was die Anmeldung von der App braucht: wohin es nach dem Anmelden geht, weiss nur sie. */
interface LoginNavigation {
    val navController: NavHostController

    /** Die Anmeldung ist gelungen; die Anmeldeziele verlassen den Stapel. */
    fun angemeldet()
}

/**
 * Einrichtung und Anmeldung als eigener Teilgraph ([LoginTarget.Bereich]): Eine
 * QR-Anmeldung beginnt in der Einrichtung und läuft nach dem Wechsel zur Anmeldung
 * weiter. Das ViewModel hängt deshalb am Eintrag des Teilgraphen und endet mit ihm.
 * [beginn] ist Einrichtung oder Anmeldung.
 */
fun NavGraphBuilder.loginGraph(navigation: LoginNavigation, beginn: LoginTarget) {
    navigation<LoginTarget.Bereich>(startDestination = beginn) {
        setupTarget(navigation.navController)
        loginTarget(navigation)
    }
}

/** Das ViewModel des Teilgraphen, an dessen Eintrag gebunden. */
@Composable
private fun loginViewModel(navController: NavHostController, entry: NavBackStackEntry): AnmeldungViewModel {
    val bereich = remember(entry) { navController.getBackStackEntry<LoginTarget.Bereich>() }
    return hiltViewModel(bereich)
}

/** Serveradresse eintragen oder per QR-Code übernehmen. */
private fun NavGraphBuilder.setupTarget(navController: NavHostController) {
    composable<LoginTarget.Setup> { entry ->
        val loginVm = loginViewModel(navController, entry)
        val state by loginVm.state.collectAsStateWithLifecycle()
        SetupScreen(
            currentUrl = state.serverUrl,
            // Ein anderer Server meldet über den vollen Weg der App ab, bevor die
            // neue Adresse gilt (AnmeldungViewModel.saveServerUrl).
            onSave = { url ->
                if (loginVm.saveServerUrl(url)) {
                    navController.navigate(LoginTarget.Login) {
                        popUpTo<LoginTarget.Setup> { inclusive = true }
                    }
                }
            },
            // Erst nach der Bestätigung im Einrichtungsbildschirm; die Anmeldung
            // springt nach Erfolg in die Galerie.
            onQrScanned = { qr, pinInput ->
                // Der Gerätename steht im Browser bei der Frage „Gerät koppeln?“.
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

/** Anmelden, Registrieren und Passkey; während der Server startet, sein Fortschritt. */
private fun NavGraphBuilder.loginTarget(navigation: LoginNavigation) {
    val navController = navigation.navController
    composable<LoginTarget.Login> { entry ->
        val loginVm = loginViewModel(navController, entry)
        val state by loginVm.state.collectAsStateWithLifecycle()
        val anmeldeZustand by loginVm.anmeldeState.collectAsStateWithLifecycle()
        val aktivitaet = LocalContext.current
        val passkeys = remember(aktivitaet) { CredentialManagerQuery(aktivitaet) }
        // Einmal beim Betreten: Steht die Registrierung ueberhaupt offen?
        // Ohne Anmeldung erreichbar — die Frage kommt ja, bevor es ein
        // Konto gibt. `Unit` als Schluessel: genau einmal je Aufbau, nicht
        // bei jeder Zustandsaenderung.
        LaunchedEffect(Unit) { loginVm.openCheckRegistration() }
        // Startet der Server gerade, steht statt des Formulars der Fortschritt: Die
        // Netzmeldung klänge nach einem Fehler. `startupStatus` hat nur einen Wert,
        // wenn der Server antwortet und `ready` verneint.
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
            // Die Abfrage hängt an der Activity (Auswahldialog des Systems); das ViewModel lebt länger.
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
        // Ausserhalb des if/else: Meldet sich jemand an, waehrend der Server
        // noch startet — moeglich, weil der Wechsel jederzeit kommen kann —,
        // soll der Sprung in die Galerie trotzdem passieren.
        LaunchedEffect(state.isLoggedIn) {
            if (state.isLoggedIn) navigation.angemeldet()
        }
    }
}
