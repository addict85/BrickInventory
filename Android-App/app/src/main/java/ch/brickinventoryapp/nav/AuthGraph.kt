package ch.brickinventoryapp.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import ch.brickinventoryapp.*
import ch.brickinventoryapp.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.ui.CredentialManagerAbfrage
import ch.brickinventoryapp.ui.screens.ServerStartAnzeige

/** Navigationsziele der Anmeldung; das AnmeldungViewModel lebt an der Activity. */
fun NavGraphBuilder.authGraph(u: ZielUmgebung) {
    einrichtungsZiel(u)
    anmeldeZiel(u)
}

/** Serveradresse eintragen oder per QR-Code übernehmen. */
private fun NavGraphBuilder.einrichtungsZiel(u: ZielUmgebung) {
    val navController = u.navController
        composable<Screen.Setup> {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val anmeldungVm = u.aktivitaet.anmeldung
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
                    anmeldungVm.loginWithQrToken(qr.url, qr.token, fingerabdruck = qr.fingerabdruck,
                        pinWechselEingabe = pinEingabe)
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
private fun NavGraphBuilder.anmeldeZiel(u: ZielUmgebung) {
    val navController = u.navController
        composable<Screen.Login> {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val anmeldungVm = u.aktivitaet.anmeldung
            val state by anmeldungVm.state.collectAsStateWithLifecycle()
            val anmeldung by anmeldungVm.anmeldeState.collectAsStateWithLifecycle()
            val aktivitaet = androidx.compose.ui.platform.LocalContext.current
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
                isLoading = anmeldung.loginLaeuft,
                error = anmeldung.loginError,
                codeNoetig = anmeldung.codeNoetig,
                formular = anmeldung.formular,
                registrierungOffen = anmeldung.registrierungOffen,
                kontoLaeuft = anmeldung.laeuft,
                kontoMeldung = anmeldung.meldung,
                kontoFehler = anmeldung.fehler,
                onLogin = { user, pw, code -> anmeldungVm.login(user, pw, code) },
                vollerZugriff = anmeldung.vollerZugriff,
                onVollerZugriff = { anmeldungVm.setzeVollerZugriff(it) },
                // Die Abfrage hängt an der Activity (Auswahldialog des Systems); das ViewModel lebt länger.
                onPasskey = { anmeldungVm.passkeyAnmelden(passkeys) },
                passkeyStattCode = anmeldung.passkeyStattCode,
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
