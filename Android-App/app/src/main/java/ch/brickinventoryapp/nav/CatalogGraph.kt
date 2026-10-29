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
import coil3.ImageLoader
import coil3.util.DebugLogger
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
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.ui.ManualItemDetailUiState

/**
 * Navigationsziele von Katalog und Merkliste. Die Werte aus AppNavigation kommen
 * als Parameter herein, damit kein Ziel Zustand aus einem umgebenden Scope
 * einfängt.
 */
fun NavGraphBuilder.catalogGraph(
    vm: AppViewModel,
    katalog: CatalogViewModel,
    navController: NavHostController,
    imageLoader: coil3.ImageLoader,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
) {
        // ── Merkliste ──
        //
        // Hier und nicht im CollectionGraph: Eine Merkliste ist kein Bestand. Sie steht
        // dem Katalog näher — von dort kommt der häufigste Weg hinein, und wie er zeigt
        // sie Sets, die einem nicht gehören.
        composable(Screen.Wanted.route) {
            ReiterGeruest(stringResource(R.string.nav_wanted), vm, navController, bottomNavItems, snackbarHostState) {
                val erfassung = ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel<ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel>()
                ch.brickinventoryapp.ui.screens.MerklisteScreen(
                    vm = hiltViewModel<MerklisteViewModel>(),
                    imageLoader = imageLoader,
                    onScan = { erfassung.setScannerSource("wanted"); navController.navigate(Screen.BarcodeScanner.route) },
                    onOeffnen = { sn, zustand ->
                        navController.navigate(Screen.MerkpostenDetail.createRoute(sn, zustand))
                    },
                )
            }
        }
        composable(
            route = Screen.MerkpostenDetail.route,
            arguments = listOf(
                androidx.navigation.navArgument("setNumber") { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("condition") { type = androidx.navigation.NavType.StringType },
            ),
        ) { backStack ->
            ch.brickinventoryapp.ui.screens.MerkpostenDetailScreen(
                vm = hiltViewModel<MerklisteViewModel>(),
                setNumber = backStack.arguments?.getString("setNumber") ?: "",
                condition = backStack.arguments?.getString("condition") ?: "N",
                imageLoader = imageLoader,
                onBack = { navController.popBackStack() },
            )
        }
        composable(Screen.Catalog.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val catalogState by katalog.state.collectAsStateWithLifecycle()
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
            val blick by vm.blickfeld.collectAsStateWithLifecycle()
            val catSetNumber = backStack.arguments?.getString("setNumber") ?: ""
            val merkliste: MerklisteViewModel = hiltViewModel()
            val erfassung = ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel<ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel>()
            val catalogState by katalog.state.collectAsStateWithLifecycle()
            val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
            // loadCatalogDetail() meldet über denselben Kanal wie alle ViewModels
            // (data/MeldungsKanal.kt), eingesammelt in AppNavigation.kt.
            CatalogDetailScreen(
                setNumber = catSetNumber,
                detail = catalogState.detail?.takeIf { it.setNumber == catSetNumber },
                isLoading = catalogState.detailLoading,
                imageLoader = imageLoader,
                serverUrl = state.serverUrl,
                defaultCondition = state.userDefaultCondition ?: "N",
                onLoad = katalog::loadCatalogDetail,
                householdMembers = blick.householdMembers,
                // Der VORRAT an Lagerorten, nicht die belegten Orte: Beim
                // Erfassen soll auch ein leeres Regal zur Wahl stehen.
                lagerorte = lagerZustand.eigene.map { it.name },
                lagerortVorgabe = lagerZustand.vorgabe?.name ?: "",
                onAddToGallery = { sn, qty, price, cond, owner, ort ->
                    // Das Aufnehmen gehört der Galerie, das „besitze ich“ dem Katalog — die
                    // Abhängigkeit steht hier sichtbar statt versteckt in einer gemeinsamen
                    // Funktion.
                    erfassung.addSet(sn, qty, price, cond, owner, ort)
                    katalog.markiereAufgenommen(sn, qty)
                },
                // Merkposten UND Preisalarm in einem Griff — die Regel dahinter
                // steht im MerklisteViewModel, nicht hier.
                onWish = { sn, zustand, richtung, schwelle, konto ->
                    merkliste.merkpostenMitAlarm(sn, zustand, richtung, schwelle, konto)
                },
                onOpenInGallery = { sn -> navController.navigate(Screen.SetDetail.createRoute(sn)) },
                onBack = { navController.popBackStack() }
            )
        }
}
