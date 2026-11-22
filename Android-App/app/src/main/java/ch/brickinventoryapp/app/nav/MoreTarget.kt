package ch.brickinventoryapp.app.nav

import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.app.MoreScreen
import ch.brickinventoryapp.app.openOfMore
import ch.brickinventoryapp.resources.R
import kotlinx.serialization.Serializable

/** The destinations that belong to no area. */
@Serializable
internal sealed interface AppTarget {
    /** Everything that is not an inventory tab — the fifth destination of the bottom bar. */
    @Serializable data object More : AppTarget
}

/** “More” belongs to no area: it leads to all that are not in the bottom bar. */
internal fun NavGraphBuilder.moreTarget(u: TargetEnvironment) {
    val navController = u.navController
    composable<AppTarget.More> {
        val vm = u.activity.app
        val state by vm.state.collectAsStateWithLifecycle()
        val update by u.update.updateState.collectAsStateWithLifecycle()
        u.Tab(stringResource(R.string.nav_more)) {
            MoreScreen(
                onTarget = navController::openOfMore,
                isAdmin = state.isAdmin,
                updateAvailable = update.newerVersion != null,
                onLogout = {
                    vm.logout()
                    u.loggedOut()
                },
            )
        }
    }
}
