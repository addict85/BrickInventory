package ch.brickinventoryapp.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Petrol
import coil.ImageLoader
import coil.util.DebugLogger
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.painterResource
import ch.brickinventoryapp.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.LinearProgressIndicator
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.res.stringResource
import javax.inject.Named
import javax.inject.Inject
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.navArgument
import ch.brickinventoryapp.*
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.ui.ManualItemDetailUiState

/**
 * Navigationsziele, aus AppNavigation.kt herausgelöst (Punkt 9 der
 * Optimierungsliste). Die Blöcke sind unverändert übernommen — die einzige
 * Änderung ist, dass die zuvor aus dem umgebenden Scope eingefangenen Werte
 * jetzt als Parameter hereinkommen.
 *
 * ACHTUNG: Diese Aufteilung wurde ohne Android-SDK erzeugt und ist NICHT
 * kompiliert. Fehlende oder falsch typisierte Parameter fallen beim ersten
 * ./gradlew assembleDebug auf.
 */
fun NavGraphBuilder.catalogGraph(
    vm: MainViewModel,
    katalog: CatalogViewModel,
    navController: NavHostController,
    imageLoader: coil.ImageLoader,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
) {
        composable(Screen.Catalog.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val catalogState by katalog.state.collectAsStateWithLifecycle()
            // Hier stand die Weiterleitung der Katalog-Meldungen an das
            // MainViewModel — zweimal in dieser Datei, wortgleich. Sie ist weg:
            // Beide ViewModels schreiben jetzt in denselben Kanal
            // (data/MeldungsKanal.kt), eingesammelt wird er in AppNavigation.kt.
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank() && catalogState.loadedPages.isEmpty() && !catalogState.isLoading) {
                    katalog.loadCatalogMeta(); katalog.loadCatalogSets()
                }
            }
            ReiterGeruest(stringResource(R.string.nav_catalog), vm, navController, bottomNavItems, snackbarHostState) {
                CatalogScreen(
                    vm = vm,
                    katalog = katalog,
                    imageLoader = imageLoader,
                    onSetClick = { navController.navigate(Screen.CatalogDetail.createRoute(it)) },
                )
            }
        }
        composable(
            route = Screen.CatalogDetail.route,
            arguments = listOf(androidx.navigation.navArgument("setNumber") {
                type = androidx.navigation.NavType.StringType
            })
        ) { backStack ->
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val catSetNumber = backStack.arguments?.getString("setNumber") ?: ""
            val catalogState by katalog.state.collectAsStateWithLifecycle()
            // loadCatalogDetail() meldet ebenfalls („Set nicht gefunden",
            // Netzfehler). Die Bruecke dafuer stand hier und ist entfallen —
            // siehe oben und data/MeldungsKanal.kt.
            CatalogDetailScreen(
                setNumber = catSetNumber,
                detail = catalogState.detail?.takeIf { it.setNumber == catSetNumber },
                isLoading = catalogState.detailLoading,
                imageLoader = imageLoader,
                serverUrl = state.serverUrl,
                defaultCondition = state.userDefaultCondition ?: "N",
                onLoad = katalog::loadCatalogDetail,
                householdMembers = state.householdMembers,
                onAddToGallery = { sn, qty, price, cond, owner ->
                    // Das Aufnehmen gehoert der Galerie, das „besitze ich"
                    // dem Katalog. Frueher tat addCatalogSetToGallery() beides
                    // in einer Funktion — die Abhaengigkeit steht jetzt sichtbar
                    // hier statt versteckt dort.
                    vm.addSet(sn, qty, price, cond, owner)
                    katalog.markiereAufgenommen(sn, qty)
                },
                onOpenInGallery = { sn -> navController.navigate(Screen.SetDetail.createRoute(sn)) },
                onBack = { navController.popBackStack() }
            )
        }
}
