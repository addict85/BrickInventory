package ch.brickinventoryapp.verwaltung.ui

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.Schrittsperre
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringRoute
import ch.brickinventoryapp.navigation.Bereichsumgebung

/** Die Verwaltung braucht nur, was jeder Bereich bekommt. */
interface VerwaltungNavigation : Bereichsumgebung

/** Die Verwalterseite. */
fun NavGraphBuilder.verwaltungGraph(navigation: VerwaltungNavigation) {
    composable<VerwaltungZiel.Monitoring> {
        // Fällt das Verwalterrecht weg, verlässt die Seite sich selbst, statt weiter 403 zu sammeln.
        val stand by navigation.sitzung.collectAsStateWithLifecycle()
        LaunchedEffect(stand.isAdmin) { if (!stand.isAdmin) navigation.navController.popBackStack() }
        navigation.Reiter(stringResource(R.string.nav_monitoring)) {
            // Verwalteraktionen nur nach der Gerätesperre; kein Tipp durch eine Überlagerung.
            Ueberdeckungsschutz()
            Schrittsperre(stringResource(R.string.schritt_verwaltung), Schrittaktion.VERWALTUNG) {
                MonitoringRoute(appTheme = stand.appTheme, onEinstellungenNeu = { navigation.ladeEinstellungen() })
            }
        }
    }
}
