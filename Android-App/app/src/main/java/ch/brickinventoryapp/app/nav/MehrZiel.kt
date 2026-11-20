package ch.brickinventoryapp.app.nav

import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.app.MehrBildschirm
import ch.brickinventoryapp.app.openOfMore
import ch.brickinventoryapp.resources.R
import kotlinx.serialization.Serializable

/** Die Ziele, die keinem Bereich gehören. */
@Serializable
internal sealed interface AppTarget {
    /** Alles, was kein Bestandsreiter ist — das fünfte Ziel der unteren Leiste. */
    @Serializable data object Mehr : AppTarget
}

/** „Mehr“ gehört keinem Bereich: Es führt zu allen, die nicht in der unteren Leiste stehen. */
internal fun NavGraphBuilder.moreTarget(u: TargetEnvironment) {
    val navController = u.navController
    composable<AppTarget.Mehr> {
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        val update by u.update.updateState.collectAsStateWithLifecycle()
        u.Reiter(stringResource(R.string.nav_more)) {
            MehrBildschirm(
                onTarget = navController::openOfMore,
                isAdmin = state.isAdmin,
                updateVerfuegbar = update.newerVersion != null,
                onAbmelden = {
                    vm.logout()
                    u.abgemeldet()
                },
            )
        }
    }
}
