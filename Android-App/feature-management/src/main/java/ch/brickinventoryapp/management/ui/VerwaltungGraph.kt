package ch.brickinventoryapp.management.ui

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Schrittsperre
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.management.ui.screens.MonitoringRoute
import ch.brickinventoryapp.navigation.Bereichsumgebung

/** Management only needs what every area gets. */
interface ManagementNavigation : Bereichsumgebung

/** Die Verwalterseite. */
fun NavGraphBuilder.managementGraph(navigation: ManagementNavigation) {
    composable<ManagementTarget.Monitoring> {
        // If admin rights are lost, the page leaves on its own instead of continuing to collect 403s.
        val stand by navigation.sitzung.collectAsStateWithLifecycle()
        LaunchedEffect(stand.isAdmin) { if (!stand.isAdmin) navigation.navController.popBackStack() }
        navigation.Reiter(stringResource(R.string.nav_monitoring)) {
            // Admin actions only after the device lock; no tap through an overlay.
            Ueberdeckungsschutz()
            Schrittsperre(stringResource(R.string.schritt_verwaltung), Schrittaktion.VERWALTUNG) {
                MonitoringRoute(appTheme = stand.appTheme, onSettingsNew = { navigation.ladeEinstellungen() })
            }
        }
    }
}
