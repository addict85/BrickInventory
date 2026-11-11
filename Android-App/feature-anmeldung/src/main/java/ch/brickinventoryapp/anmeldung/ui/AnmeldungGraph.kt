package ch.brickinventoryapp.anmeldung.ui

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import ch.brickinventoryapp.anmeldung.ui.screens.ServerStartAnzeige
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.anmeldung.ui.viewmodel.AnmeldungViewModel

/** Was die Anmeldung von der App braucht: wohin es nach dem Anmelden geht, weiss nur sie. */
interface AnmeldungNavigation {
    val navController: NavHostController

    /** Die Anmeldung ist gelungen; die Anmeldeziele verlassen den Stapel. */
    fun angemeldet()
}

/**
 * Einrichtung und Anmeldung als eigener Teilgraph ([AnmeldeZiel.Bereich]): Eine
 * QR-Anmeldung beginnt in der Einrichtung und läuft nach dem Wechsel zur Anmeldung
 * weiter. Das ViewModel hängt deshalb am Eintrag des Teilgraphen und endet mit ihm.
 * [beginn] ist Einrichtung oder Anmeldung.
 */
fun NavGraphBuilder.anmeldungGraph(navigation: AnmeldungNavigation, beginn: AnmeldeZiel) {
    navigation<AnmeldeZiel.Bereich>(startDestination = beginn) {
        einrichtungsZiel(navigation.navController)
        anmeldeZiel(navigation)
    }
}

/** Das ViewModel des Teilgraphen, an dessen Eintrag gebunden. */
@Composable
private fun anmeldungViewModel(navController: NavHostController, eintrag: NavBackStackEntry): AnmeldungViewModel {
    val bereich = remember(eintrag) { navController.getBackStackEntry<AnmeldeZiel.Bereich>() }
    return hiltViewModel(bereich)
}

/** Serveradresse eintragen oder per QR-Code übernehmen. */
private fun NavGraphBuilder.einrichtungsZiel(navController: NavHostController) {
    composable<AnmeldeZiel.Setup> { eintrag ->
        val anmeldungVm = anmeldungViewModel(navController, eintrag)
        val state by anmeldungVm.state.collectAsStateWithLifecycle()
        SetupScreen(
            currentUrl = state.serverUrl,
            // Ein anderer Server meldet über den vollen Weg der App ab, bevor die
            // neue Adresse gilt (AnmeldungViewModel.saveServerUrl).
            onSave = { url ->
                if (anmeldungVm.saveServerUrl(url)) {
                    navController.navigate(AnmeldeZiel.Login) {
                        popUpTo<AnmeldeZiel.Setup> { inclusive = true }
                    }
                }
            },
            // Erst nach der Bestätigung im Einrichtungsbildschirm; die Anmeldung
            // springt nach Erfolg in die Galerie.
            onQrScanned = { qr, pinEingabe ->
                // Der Gerätename steht im Browser bei der Frage „Gerät koppeln?“.
                anmeldungVm.loginWithQrToken(qr.url, qr.token, fingerabdruck = qr.fingerabdruck,
                    pinWechselEingabe = pinEingabe, geraet = Build.MODEL.orEmpty().ifBlank { "Android App" })
                navController.navigate(AnmeldeZiel.Login) {
                    popUpTo<AnmeldeZiel.Setup> { inclusive = true }
                }
            },
            bisherigerPin = anmeldungVm::bisherigerPin,
            mussAbtippen = anmeldungVm::mussAbtippen,
        )
    }
}

/** Anmelden, Registrieren und Passkey; während der Server startet, sein Fortschritt. */
private fun NavGraphBuilder.anmeldeZiel(navigation: AnmeldungNavigation) {
    val navController = navigation.navController
    composable<AnmeldeZiel.Login> { eintrag ->
        val anmeldungVm = anmeldungViewModel(navController, eintrag)
        val state by anmeldungVm.state.collectAsStateWithLifecycle()
        val anmeldeZustand by anmeldungVm.anmeldeState.collectAsStateWithLifecycle()
        val aktivitaet = LocalContext.current
        val passkeys = remember(aktivitaet) { CredentialManagerAbfrage(aktivitaet) }
        // Einmal beim Betreten: Steht die Registrierung ueberhaupt offen?
        // Ohne Anmeldung erreichbar — die Frage kommt ja, bevor es ein
        // Konto gibt. `Unit` als Schluessel: genau einmal je Aufbau, nicht
        // bei jeder Zustandsaenderung.
        LaunchedEffect(Unit) { anmeldungVm.pruefeRegistrierungOffen() }
        // Startet der Server gerade, steht statt des Formulars der Fortschritt: Die
        // Netzmeldung klänge nach einem Fehler. `startupStatus` hat nur einen Wert,
        // wenn der Server antwortet und `ready` verneint.
        val serverStart = state.startupStatus
        if (serverStart != null) {
            ServerStartAnzeige(serverStart)
        } else LoginScreen(
            serverUrl = state.serverUrl,
            isLoading = anmeldeZustand.loginLaeuft,
            error = anmeldeZustand.loginError,
            qrBestaetigung = anmeldeZustand.qrBestaetigung,
            codeNoetig = anmeldeZustand.codeNoetig,
            formular = anmeldeZustand.formular,
            registrierungOffen = anmeldeZustand.registrierungOffen,
            kontoLaeuft = anmeldeZustand.laeuft,
            kontoMeldung = anmeldeZustand.meldung,
            kontoFehler = anmeldeZustand.fehler,
            onLogin = { user, pw, code -> anmeldungVm.login(user, pw, code) },
            vollerZugriff = anmeldeZustand.vollerZugriff,
            onVollerZugriff = { anmeldungVm.setzeVollerZugriff(it) },
            // Die Abfrage hängt an der Activity (Auswahldialog des Systems); das ViewModel lebt länger.
            onPasskey = { anmeldungVm.passkeyAnmelden(passkeys) },
            passkeyStattCode = anmeldeZustand.passkeyStattCode,
            onPasskeyStattCode = { user, pw -> anmeldungVm.passkeyStattCode(user, pw, passkeys) },
            onFormular = { anmeldungVm.zeigeAnmeldeFormular(it) },
            onRegistrieren = { u, e, v, n, pw -> anmeldungVm.registriere(u, e, v, n, pw) },
            onPasswortVergessen = { anmeldungVm.passwortVergessen(it) },
            onChangeServer = {
                navController.navigate(AnmeldeZiel.Setup) {
                    popUpTo<AnmeldeZiel.Login> { inclusive = true }
                }
            }
        )
        // Ausserhalb des if/else: Meldet sich jemand an, waehrend der Server
        // noch startet — moeglich, weil der Wechsel jederzeit kommen kann —,
        // soll der Sprung in die Galerie trotzdem passieren.
        LaunchedEffect(state.isLoggedIn) {
            if (state.isLoggedIn) navigation.angemeldet()
        }
    }
}
