package ch.brickinventoryapp.nav

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import ch.brickinventoryapp.ui.Screen
import coil3.ImageLoader

/** Ein Ziel der unteren Leiste: Route, Symbol und Beschriftung. */
typealias Reiter = Triple<Screen, @Composable () -> Unit, String>

/**
 * Was alle Ziele teilen und oberhalb des NavHost lebt. Die ViewModels der Ziele
 * holen die Graphen selbst; die der Activity kommen über [aktivitaet], erst beim
 * Zeigen gelesen — so lässt sich der ganze Graph ohne Hilt aufbauen und prüfen.
 */
class ZielUmgebung(
    val navController: NavHostController,
    val imageLoader: ImageLoader,
    val reiter: List<Reiter>,
    val snackbarHostState: SnackbarHostState,
    val rollen: Rollzustaende,
    private val zustaende: () -> AktivitaetsZustand,
) {
    val aktivitaet: AktivitaetsZustand get() = zustaende()
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
