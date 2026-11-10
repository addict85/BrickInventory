package ch.brickinventoryapp.zustand.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
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
    val rollen: Rollzustaende

    /** Sitzung, Filter und Rollgedächtnis; lebt mit der Activity und wird erst beim Zeigen gelesen. */
    val app: AppViewModel

    /** Ein Ziel der unteren Leiste: Titel oben, Leiste unten, Snackbar dazwischen. */
    @Composable
    fun Reiter(titel: String, inhalt: @Composable () -> Unit)
}

/**
 * Rollpositionen der Listen. Sie liegen oberhalb der Ziele, weil ein Ziel beim
 * Öffnen einer Detailansicht verworfen wird; ein Zustand darin stünde bei der
 * Rückkehr wieder oben.
 */
class Rollzustaende(
    val galerie: LazyGridState,
    val teile: LazyGridState,
    val minifiguren: LazyGridState,
    val finanzen: LazyListState,
    val teileliste: LazyListState,
    val einstellungen: ScrollState,
)
