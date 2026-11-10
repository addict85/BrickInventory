package ch.brickinventoryapp.app.nav

import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.brickinventoryapp.app.MehrBildschirm
import ch.brickinventoryapp.app.oeffneVonMehr
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.Screen

/** „Mehr“ gehört keinem Bereich: Es führt zu allen, die nicht in der unteren Leiste stehen. */
internal fun NavGraphBuilder.mehrZiel(u: ZielUmgebung) {
    val navController = u.navController
    composable<Screen.Mehr> {
        val vm = u.app
        val state by vm.state.collectAsStateWithLifecycle()
        val update by u.update.updateState.collectAsStateWithLifecycle()
        u.Reiter(stringResource(R.string.nav_more)) {
            MehrBildschirm(
                onZiel = navController::oeffneVonMehr,
                isAdmin = state.isAdmin,
                updateVerfuegbar = update.neuereFassung != null,
                onAbmelden = {
                    vm.logout()
                    navController.navigate(Screen.Login) { popUpTo(0) { inclusive = true } }
                },
            )
        }
    }
}
