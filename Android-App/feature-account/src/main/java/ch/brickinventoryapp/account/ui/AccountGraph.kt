package ch.brickinventoryapp.account.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.account.ui.screens.AccountRoute
import ch.brickinventoryapp.account.ui.screens.CsvImportRoute
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.screens.SettingsRoute
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.navigation.AreaEnvironment
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel
import ch.brickinventoryapp.ui.ScrollPositionKeeper

/**
 * What the settings need from the app: update, design and certificate live with
 * the Activity, because their notice sits above every screen, or because they
 * decide the whole app's theme.
 */
interface AccountNavigation : AreaEnvironment {
    val update: UpdateViewModel
    val appearance: AppearanceViewModel
    val trust: TrustViewModel

    /** Signed out: back to sign-in, with no way back into the app. */
    fun loggedOut()

    /** Entering a different server; that belongs to sign-in. */
    fun openSetup()

    fun openSet(setNumber: String)
}

/** Settings and its subpages. */
fun NavGraphBuilder.accountGraph(navigation: AccountNavigation) {
    settingsTarget(navigation)
    subpages(navigation)
}

private fun NavGraphBuilder.settingsTarget(navigation: AccountNavigation) {
    composable<AccountTarget.Settings> {
        // One state per visit; only ScrollMemory (the keeper below) remembers the position.
        val settingsScrollState = remember { ScrollState(0) }
        // SettingsViewModel loads the settings while observing; household,
        // vouchers, profile and devices are each fetched by their own subpage when opened.
        navigation.Tab(stringResource(R.string.nav_settings)) {
            ScrollPositionKeeper(
                AccountTarget.Settings.rollKey, settingsScrollState, navigation.scrollMemory)
            SettingsRoute(
                vm = hiltViewModel<SettingsViewModel>(),
                onLogout = { navigation.logout(); navigation.loggedOut() },
                onServerSwitch = navigation::openSetup,
                // The categories don't navigate further from here; they sit on "More"
                // (MoreScreen.kt).
                scrollState = settingsScrollState,
                selfUpdate = navigation.update,
                appearance = navigation.appearance,
                trust = navigation.trust,
            )
        }
    }
}

/**
 * The settings' subpages, without a bottom bar: a subpage carries a
 * back arrow and brings its own snackbar host.
 */
private fun NavGraphBuilder.subpages(navigation: AccountNavigation) {
    val navController = navigation.navController
    val snackbarHostState = navigation.snackbar
    composable<AccountTarget.PriceAlarms> {
        val state by navigation.session.collectAsStateWithLifecycle()
        PriceAlarmsRoute(
            vm = hiltViewModel<SettingsViewModel>(),
            imageLoader = navigation.images,
            serverUrl = state.serverUrl,
            snackbarHostState = snackbarHostState,
            // The same detail view as from the gallery and finances — a
            // second route there would be a second place for the same
            // rules.
            onSetClick = navigation::openSet,
            onBack = { navController.popBackStack() },
        )
    }

    composable<AccountTarget.StorageLocations> {
        LocationsRoute(hiltViewModel<SettingsViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<AccountTarget.Household> {
        HouseholdRoute(hiltViewModel<HouseholdViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<AccountTarget.CsvImport> {
        CsvImportRoute(hiltViewModel<SettingsViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<AccountTarget.Account> {
        AccountRoute(snackbarHostState) { navController.popBackStack() }
    }
}
