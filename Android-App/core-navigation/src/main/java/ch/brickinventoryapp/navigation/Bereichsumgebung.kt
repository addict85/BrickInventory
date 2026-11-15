package ch.brickinventoryapp.navigation

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.zustand.ui.LagerUiState
import coil3.ImageLoader
import kotlinx.coroutines.flow.StateFlow

/**
 * Was jeder Bereich von der App braucht, um seine Ziele zu zeigen. Ein Bereich liefert
 * `NavGraphBuilder.xyzGraph(navigation)`; seine Navigationsschnittstelle erweitert diese
 * und nennt dazu, was er von anderen Bereichen braucht. Die App setzt nur zusammen.
 */
interface Bereichsumgebung {
    val navController: NavHostController
    val bilder: ImageLoader
    val snackbar: SnackbarHostState

    // Nur, was die Ziele lesen, statt des AppViewModels: Ein Bereich soll nicht über die
    // Umgebung an alles kommen, was die Activity hält. Gelesen wird erst beim Zeigen.
    val sitzung: StateFlow<AppUiState>
    val blickfeld: StateFlow<BlickfeldUiState>
    val lager: StateFlow<LagerUiState>
    val rollgedaechtnis: ScrollMemory
    fun ladeEinstellungen()
    fun abmelden()

    /** Ein Ziel der unteren Leiste: Titel oben, Leiste unten, Snackbar dazwischen. */
    @Composable
    fun Reiter(titel: String, inhalt: @Composable () -> Unit)
}
