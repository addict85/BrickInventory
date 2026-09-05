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
import coil.ImageLoader
import coil.util.DebugLogger
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
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.ManualItemDetailUiState

/**
 * Navigationsziele, aus AppNavigation.kt herausgelöst (Punkt 9 der
 * Optimierungsliste). Die Blöcke sind unverändert übernommen — die einzige
 * Änderung ist, dass die zuvor aus dem umgebenden Scope eingefangenen Werte
 * jetzt als Parameter hereinkommen.
 *
 * ACHTUNG: Diese Aufteilung wurde ohne Android-SDK erzeugt und ist NICHT
 * kompiliert. Fehlende oder falsch typisierte Parameter fallen beim ersten
 * ./gradlew assembleDebug auf.
 */
fun NavGraphBuilder.authGraph(
    vm: MainViewModel,
    navController: NavHostController,
) {
        composable(Screen.Setup.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            SetupScreen(
                currentUrl = state.serverUrl,
                onSave = { url ->
                    vm.saveServerUrl(url)
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Setup.route) { inclusive = true }
                    }
                },
                onQrScanned = { url, token ->
                    // Save server URL and auto-login with QR token
                    vm.saveServerUrl(url)
                    vm.loginWithQrToken(url, token)
                    // Navigate to login screen (will auto-redirect to gallery on success)
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Setup.route) { inclusive = true }
                    }
                }
            )
        }
        composable(Screen.Login.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val anmeldung by vm.anmeldeState.collectAsStateWithLifecycle()
            // Einmal beim Betreten: Steht die Registrierung ueberhaupt offen?
            // Ohne Anmeldung erreichbar — die Frage kommt ja, bevor es ein
            // Konto gibt. `Unit` als Schluessel: genau einmal je Aufbau, nicht
            // bei jeder Zustandsaenderung.
            LaunchedEffect(Unit) { vm.pruefeRegistrierungOffen() }
            // ── Startet der Server gerade? (Nachtrag 136) ────────────────────
            //
            // Dann statt des Formulars der Fortschritt. Sich anzumelden hat in
            // dieser Zeit ohnehin keinen Zweck — der Server antwortet noch
            // nicht —, und die allgemeine Netzmeldung sagt genau das Falsche:
            // Sie klingt nach einem Fehler, obwohl alles richtig laeuft.
            //
            // `startupStatus` steht nur dann auf einem Wert, wenn der Server
            // ANTWORTET und `ready` verneint. Ist er gar nicht erreichbar,
            // bleibt es bei null und die Anmeldung sieht aus wie immer.
            val serverStart = state.startupStatus
            if (serverStart != null) {
                ch.brickinventoryapp.ui.screens.ServerStartAnzeige(serverStart)
            } else LoginScreen(
                serverUrl = state.serverUrl,
                isLoading = state.loginLaeuft,
                error = state.loginError,
                formular = anmeldung.formular,
                registrierungOffen = anmeldung.registrierungOffen,
                kontoLaeuft = anmeldung.laeuft,
                kontoMeldung = anmeldung.meldung,
                kontoFehler = anmeldung.fehler,
                onLogin = { user, pw -> vm.login(user, pw) },
                onFormular = { vm.zeigeAnmeldeFormular(it) },
                onRegistrieren = { u, e, v, n, pw -> vm.registriere(u, e, v, n, pw) },
                onPasswortVergessen = { vm.passwortVergessen(it) },
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
