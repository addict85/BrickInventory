package ch.brickinventoryapp.zustand.ui

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import coil3.ImageLoader

/**
 * Was jeder Bereich von der App braucht, um seine Ziele zu zeigen. Ein Bereich liefert
 * `NavGraphBuilder.xyzGraph(navigation)`; seine Navigationsschnittstelle erweitert diese
 * und nennt dazu, was er von anderen Bereichen braucht. Die App setzt nur zusammen.
 */
interface Bereichsumgebung {
    val navController: NavHostController
    val bilder: ImageLoader
    val snackbar: SnackbarHostState

    /** Sitzung, Filter und Rollgedächtnis; lebt mit der Activity und wird erst beim Zeigen gelesen. */
    val app: AppViewModel

    /** Ein Ziel der unteren Leiste: Titel oben, Leiste unten, Snackbar dazwischen. */
    @Composable
    fun Reiter(titel: String, inhalt: @Composable () -> Unit)
}
