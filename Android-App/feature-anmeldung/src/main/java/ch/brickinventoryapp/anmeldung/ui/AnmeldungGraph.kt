package ch.brickinventoryapp.anmeldung.ui

import android.os.Build
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.anmeldung.ui.screens.ServerStartAnzeige
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.anmeldung.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.zustand.ui.Screen

/**
 * Navigationsziele der Anmeldung. Das ViewModel lebt an der Activity, weil eine
 * QR-Anmeldung in der Einrichtung beginnt und nach dem Wechsel zur Anmeldung
 * weiterläuft; die App reicht es herein, gelesen erst beim Zeigen.
 */
fun NavGraphBuilder.anmeldungGraph(navController: NavHostController, anmeldung: () -> AnmeldungViewModel) {
    einrichtungsZiel(navController, anmeldung)
    anmeldeZiel(navController, anmeldung)
}

/** Serveradresse eintragen oder per QR-Code übernehmen. */
private fun NavGraphBuilder.einrichtungsZiel(navController: NavHostController, anmeldung: () -> AnmeldungViewModel) {
    composable<Screen.Setup> {
        // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
        // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
        val anmeldungVm = anmeldung()
        val state by anmeldungVm.state.collectAsStateWithLifecycle()
        SetupScreen(
            currentUrl = state.serverUrl,
            // Ein anderer Server meldet über den vollen Weg der App ab, bevor die
            // neue Adresse gilt (AnmeldungViewModel.saveServerUrl).
            onSave = { url ->
                if (anmeldungVm.saveServerUrl(url)) {
                    navController.navigate(Screen.Login) {
                        popUpTo<Screen.Setup> { inclusive = true }
                    }
                }
            },
            // Erst nach der Bestätigung im Einrichtungsbildschirm; die Anmeldung
            // springt nach Erfolg in die Galerie.
            onQrScanned = { qr, pinEingabe ->
                // Der Gerätename steht im Browser bei der Frage „Gerät koppeln?“.
                anmeldungVm.loginWithQrToken(qr.url, qr.token, fingerabdruck = qr.fingerabdruck,
                    pinWechselEingabe = pinEingabe, geraet = Build.MODEL.orEmpty().ifBlank { "Android App" })
                navController.navigate(Screen.Login) {
                    popUpTo<Screen.Setup> { inclusive = true }
                }
            },
            bisherigerPin = anmeldungVm::bisherigerPin,
            mussAbtippen = anmeldungVm::mussAbtippen,
        )
    }
}

/** Anmelden, Registrieren und Passkey; während der Server startet, sein Fortschritt. */
private fun NavGraphBuilder.anmeldeZiel(navController: NavHostController, anmeldung: () -> AnmeldungViewModel) {
    composable<Screen.Login> {
        // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
        // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
        val anmeldungVm = anmeldung()
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
                navController.navigate(Screen.Setup) {
                    popUpTo<Screen.Login> { inclusive = true }
                }
            }
        )
        // Ausserhalb des if/else: Meldet sich jemand an, waehrend der Server
        // noch startet — moeglich, weil der Wechsel jederzeit kommen kann —,
        // soll der Sprung in die Galerie trotzdem passieren.
        LaunchedEffect(state.isLoggedIn) {
            if (state.isLoggedIn) {
                navController.navigate(Screen.Gallery) {
                    popUpTo<Screen.Login> { inclusive = true }
                }
            }
        }
    }
}
