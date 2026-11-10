package ch.brickinventoryapp.konto.ui

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.konto.ui.screens.CsvImportRoute
import ch.brickinventoryapp.konto.ui.screens.HaushaltRoute
import ch.brickinventoryapp.konto.ui.screens.KontoRoute
import ch.brickinventoryapp.konto.ui.screens.LagerorteRoute
import ch.brickinventoryapp.konto.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.konto.ui.screens.SettingsRoute
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.HaushaltViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.zustand.ui.Bereichsumgebung
import ch.brickinventoryapp.zustand.ui.Screen
import ch.brickinventoryapp.zustand.ui.rollSchluessel
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel

/**
 * Was die Einstellungen von der App brauchen: Update, Design und Zertifikat leben mit
 * der Activity, weil ihr Hinweis über jedem Bildschirm steht bzw. das Thema der
 * ganzen App bestimmt.
 */
interface KontoNavigation : Bereichsumgebung {
    val update: UpdateViewModel
    val darstellung: DarstellungViewModel
    val vertrauen: VertrauenViewModel
}

/** Die Einstellungen und ihre Unterseiten. */
fun NavGraphBuilder.kontoGraph(navigation: KontoNavigation) {
    einstellungenZiel(navigation)
    unterseiten(navigation)
}

private fun NavGraphBuilder.einstellungenZiel(navigation: KontoNavigation) {
    val navController = navigation.navController
    val settingsScrollState = navigation.rollen.einstellungen
    composable<Screen.Settings> {
        val vm = navigation.app
        val state by vm.state.collectAsStateWithLifecycle()
        // Beim Öffnen der Einstellungen laden: Der Zustand ändert sich ausserhalb kaum,
        // ein Dauerabo wäre Aufwand ohne Nutzen. Haushalt, Gutscheine, Profil und Geräte
        // holt jede Unterseite selbst, wenn man sie öffnet — wer die Sprache umstellt,
        // braucht keine Gutscheinliste.
        LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) vm.loadSettings() }
        navigation.Reiter(stringResource(R.string.nav_settings)) {
            ScrollPositionKeeper(
                Screen.Settings.rollSchluessel, settingsScrollState, vm.scrollMemory)
            SettingsRoute(
                vm = hiltViewModel<EinstellungenViewModel>(),
                onLogout = { vm.logout(); navController.navigate(Screen.Login) { popUpTo(0) { inclusive = true } } },
                onServerWechseln = { navController.navigate(Screen.Setup) },
                // Die Rubriken führen nicht von hier weiter, sondern stehen auf „Mehr“
                // (MehrBildschirm.kt).
                scrollState = settingsScrollState,
                selbstUpdate = navigation.update,
                darstellung = navigation.darstellung,
                vertrauen = navigation.vertrauen,
            )
        }
    }
}

/**
 * Die Unterseiten der Einstellungen, ohne untere Leiste: Eine Unterseite trägt einen
 * Zurück-Pfeil und bringt ihren Snackbar-Halter selbst mit.
 */
private fun NavGraphBuilder.unterseiten(navigation: KontoNavigation) {
    val navController = navigation.navController
    val snackbarHostState = navigation.snackbar
    composable<Screen.Preisalarme> {
        val state by navigation.app.state.collectAsStateWithLifecycle()
        PreisalarmeRoute(
            vm = hiltViewModel<EinstellungenViewModel>(),
            imageLoader = navigation.bilder,
            serverUrl = state.serverUrl,
            snackbarHostState = snackbarHostState,
            // Dieselbe Detailansicht wie aus Galerie und Finanzen — ein
            // zweiter Weg dorthin waere ein zweiter Ort fuer dieselben
            // Regeln.
            onSetClick = { navController.navigate(Screen.SetDetail(it)) },
            onZurueck = { navController.popBackStack() },
        )
    }

    composable<Screen.Lagerorte> {
        LagerorteRoute(hiltViewModel<EinstellungenViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.Haushalt> {
        HaushaltRoute(hiltViewModel<HaushaltViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.CsvImport> {
        CsvImportRoute(hiltViewModel<EinstellungenViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.Konto> {
        KontoRoute(snackbarHostState) { navController.popBackStack() }
    }
}
