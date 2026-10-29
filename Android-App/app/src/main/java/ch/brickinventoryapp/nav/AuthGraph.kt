package ch.brickinventoryapp.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Petrol
import coil3.ImageLoader
import coil3.util.DebugLogger
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.painterResource
import ch.brickinventoryapp.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.LinearProgressIndicator
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.res.stringResource
import javax.inject.Named
import javax.inject.Inject
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.navArgument
import ch.brickinventoryapp.*
import ch.brickinventoryapp.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.ManualItemDetailUiState

/**
 * Navigationsziele der Anmeldung. Die Werte aus AppNavigation kommen als Parameter
 * herein, damit kein Ziel Zustand aus einem umgebenden Scope einfängt.
 */
fun NavGraphBuilder.authGraph(
    vm: AppViewModel,
    navController: NavHostController,
) {
        composable(Screen.Setup.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val anmeldungVm: AnmeldungViewModel = aktivitaetsViewModel()
            val state by anmeldungVm.state.collectAsStateWithLifecycle()
            val nutzerCa by vm.nutzerCa.collectAsStateWithLifecycle()
            SetupScreen(
                currentUrl = state.serverUrl,
                nutzerCa = nutzerCa,
                onNutzerCa = { vm.setNutzerCa(it) },
                // Ein anderer Server meldet über den vollen Weg der App ab, bevor die
                // neue Adresse gilt (AnmeldungViewModel.saveServerUrl).
                onSave = { url, klartextBestaetigt ->
                    anmeldungVm.saveServerUrl(url, klartextBestaetigt, abmelden = { vm.logout().join() })
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Setup.route) { inclusive = true }
                    }
                },
                // Erst nach der Bestätigung im Einrichtungsbildschirm; die Anmeldung
                // springt nach Erfolg in die Galerie.
                onQrScanned = { url, token, klartextBestaetigt ->
                    anmeldungVm.loginWithQrToken(url, token, klartextBestaetigt, abmelden = { vm.logout().join() })
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Setup.route) { inclusive = true }
                    }
                }
            )
        }
        composable(Screen.Login.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val anmeldungVm: AnmeldungViewModel = aktivitaetsViewModel()
            val state by anmeldungVm.state.collectAsStateWithLifecycle()
            val anmeldung by anmeldungVm.anmeldeState.collectAsStateWithLifecycle()
            // Einmal beim Betreten: Steht die Registrierung ueberhaupt offen?
            // Ohne Anmeldung erreichbar — die Frage kommt ja, bevor es ein
            // Konto gibt. `Unit` als Schluessel: genau einmal je Aufbau, nicht
            // bei jeder Zustandsaenderung.
            LaunchedEffect(Unit) { anmeldungVm.pruefeRegistrierungOffen() }
            // ── Startet der Server gerade? ──
            //
            // Dann statt des Formulars der Fortschritt: Anmelden hat in dieser Zeit keinen
            // Zweck, und die allgemeine Netzmeldung klänge nach einem Fehler, obwohl alles
            // richtig läuft. `startupStatus` hat nur dann einen Wert, wenn der Server
            // antwortet und `ready` verneint; ist er gar nicht erreichbar, bleibt es bei null
            // und die Anmeldung sieht aus wie immer.
            val serverStart = state.startupStatus
            if (serverStart != null) {
                ch.brickinventoryapp.ui.screens.ServerStartAnzeige(serverStart)
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
                netzFrage = anmeldung.netzFrage,
                onNetzBestaetigt = { user, pw, code -> anmeldungVm.login(user, pw, code, netzBestaetigt = true) },
                onNetzAbgelehnt = { anmeldungVm.netzFrageVerwerfen() },
                onFormular = { anmeldungVm.zeigeAnmeldeFormular(it) },
                onRegistrieren = { u, e, v, n, pw -> anmeldungVm.registriere(u, e, v, n, pw) },
                onPasswortVergessen = { anmeldungVm.passwortVergessen(it) },
                onChangeServer = {
                    navController.navigate(Screen.Setup.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
            // Ausserhalb des if/else: Meldet sich jemand an, waehrend der Server
            // noch startet — moeglich, weil der Wechsel jederzeit kommen kann —,
            // soll der Sprung in die Galerie trotzdem passieren.
            LaunchedEffect(state.isLoggedIn) {
                if (state.isLoggedIn) {
                    navController.navigate(Screen.Gallery.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            }
        }
}
