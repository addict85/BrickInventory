package ch.brickinventoryapp.management.ui

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.management.ui.screens.MonitoringRoute
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.navigation.AreaEnvironment
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.StepLock

/** Management only needs what every area gets. */
interface ManagementNavigation : AreaEnvironment

/** Die Verwalterseite. */
fun NavGraphBuilder.managementGraph(navigation: ManagementNavigation) {
    composable<ManagementTarget.Monitoring> {
        // If admin rights are lost, the page leaves on its own instead of continuing to collect 403s.
        val state by navigation.session.collectAsStateWithLifecycle()
        LaunchedEffect(state.isAdmin) { if (!state.isAdmin) navigation.navController.popBackStack() }
        navigation.Tab(stringResource(R.string.nav_monitoring)) {
            // Admin actions only after the device lock; no tap through an overlay.
            OverlayGuard()
            StepLock(stringResource(R.string.step_admin), StepAction.ADMIN) {
                MonitoringRoute(appTheme = state.appTheme, onSettingsNew = { navigation.loadSettings() })
            }
        }
    }
}
