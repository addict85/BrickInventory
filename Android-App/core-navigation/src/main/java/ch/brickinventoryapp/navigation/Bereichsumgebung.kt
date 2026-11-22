package ch.brickinventoryapp.navigation

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
import coil3.ImageLoader
import kotlinx.coroutines.flow.StateFlow

/**
 * What every area needs from the app to show its destinations. An area delivers
 * `NavGraphBuilder.xyzGraph(navigation)`; its navigation interface extends this one
 * and names in addition what it needs from other areas. The app only assembles.
 */
interface Bereichsumgebung {
    val navController: NavHostController
    val bilder: ImageLoader
    val snackbar: SnackbarHostState

    // Only what the destinations read, instead of the AppViewModel: an area shall not get at
    // everything the activity holds via the environment. Reading happens only when showing.
    val sitzung: StateFlow<AppUiState>
    val blickfeld: StateFlow<ScopeUiState>
    val lager: StateFlow<LagerUiState>
    val rollgedaechtnis: ScrollMemory
    fun ladeEinstellungen()
    fun abmelden()

    /** A destination of the bottom bar: title on top, bar at the bottom, snackbar in between. */
    @Composable
    fun Reiter(titel: String, inhalt: @Composable () -> Unit)
}
