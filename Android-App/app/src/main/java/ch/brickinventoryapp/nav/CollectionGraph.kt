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
import ch.brickinventoryapp.ui.dialogs.SetItemDetailDialog
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
import ch.brickinventoryapp.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.viewmodel.KaeufeViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.ManualItemDetailUiState

/**
 * Navigationsziele des Bestands: Galerie, Teile, Minifiguren und ihre Details. Die
 * Werte aus AppNavigation kommen als Parameter herein, damit kein Ziel Zustand aus
 * einem umgebenden Scope einfängt.
 */
fun NavGraphBuilder.collectionGraph(
    vm: AppViewModel,
    navController: NavHostController,
    imageLoader: coil3.ImageLoader,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
    /**
     * Scroll-Zustände der drei Listen. Sie liegen ausserhalb dieser Ziele, weil
     * jedes davon beim Öffnen einer Detailansicht verlassen und danach neu
     * zusammengesetzt wird — ein `rememberLazyGridState()` im Ziel selbst wäre
     * bei der Rückkehr zurückgesetzt und die Liste spränge nach oben. Genau so
     * hält es das Finanz-Ziel seit jeher (ToolsGraph.kt).
     */
    galleryGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    partsGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    minifigsGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
) {
        composable(Screen.Gallery.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val galerieVm: GalerieViewModel = hiltViewModel()
            val state by galerieVm.state.collectAsStateWithLifecycle()
            val galerie by galerieVm.galleryState.collectAsStateWithLifecycle()
            val erfassung = ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel<ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel>()
            val barcode by erfassung.barcodeState.collectAsStateWithLifecycle()
            // Retry loading if sets are empty and server URL is available
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank() && galerie.sets.isEmpty() && !galerie.galleryLoading) {
                    galerieVm.loadSets(); galerieVm.loadStats()
                }
            }
            // Rollposition ausdrücklich wiederherstellen — der hochgezogene Zustand allein
            // landet verschoben.
            ch.brickinventoryapp.ui.ScrollPositionKeeper(
                "gallery", galleryGridState, galerie.sets.isNotEmpty(), vm.scrollMemory)

            // Gallery-Search: set found → navigate to detail
            LaunchedEffect(barcode.gefundenesSet) {
                val found = barcode.gefundenesSet
                if (found != null) {
                    erfassung.gallerySearchFoundConsumed()
                    navController.navigate(Screen.SetDetail.createRoute(found))
                }
            }
            ReiterGeruest(stringResource(R.string.nav_gallery), vm, navController, bottomNavItems, snackbarHostState) {
                GalleryScreen(
                    vm = galerieVm,
                    erfassung = erfassung,
                    imageLoader = imageLoader,
                    onScanBarcode = { erfassung.setScannerSource("gallery_search"); navController.navigate(Screen.BarcodeScanner.route) },
                    onSetClick = { navController.navigate(Screen.SetDetail.createRoute(it)) },
                    gridState = galleryGridState
                )
            }
        }
        composable(
            route = Screen.SetDetail.route,
            arguments = listOf(androidx.navigation.navArgument("setNumber") {
                type = androidx.navigation.NavType.StringType
            })
        ) { backStack ->
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val setNumber = backStack.arguments?.getString("setNumber") ?: ""
            // Die Galerie liegt als Startziel immer darunter; ihre geladene
            // Kachel zeigt das Set sofort, bis das Detail da ist.
            val galerieEintrag = remember(backStack) {
                runCatching { navController.getBackStackEntry(Screen.Gallery.route) }.getOrNull()
            }
            val vorschau = galerieEintrag?.let { eintrag ->
                val galerie by hiltViewModel<GalerieViewModel>(eintrag).galleryState.collectAsStateWithLifecycle()
                galerie.sets.find { it.setNumber == setNumber }
            }
            val detailVm: SetDetailViewModel = hiltViewModel()
            SetDetailScreen(
                setNumber = setNumber,
                vm = detailVm,
                vorschau = vorschau,
                serverUrl = state.serverUrl,
                imageLoader = imageLoader,
                onBack = { navController.popBackStack() },
                onDelete = { sn ->
                    detailVm.deleteSet(sn)
                    navController.popBackStack()
                },
                onNavigateToAcqMgmt = { type, id, colorId, title ->
                    navController.navigate(Screen.AcquisitionManagement.createRoute(type, id, colorId, title))
                },
                onOpenPdf = { url, title ->
                    navController.navigate(Screen.PdfViewer.createRoute(url, title))
                }
            )
        }
        composable(Screen.Parts.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val teileVm: TeileViewModel = hiltViewModel()
            val state by teileVm.state.collectAsStateWithLifecycle()
            val partsState by teileVm.partsState.collectAsStateWithLifecycle()
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank()) {
                    teileVm.loadParts()
                    // Farbkatalog fuer den Erfassungsdialog …
                    teileVm.loadPartsColors()
                    // … und die beiden Filterlisten mit ihren Zählwerten. Zwei verschiedene
                    // Adressen, siehe TeileApi.getPartsFilterColors.
                    teileVm.loadPartsFilters()
                }
            }
            ReiterGeruest(stringResource(R.string.nav_parts), vm, navController, bottomNavItems, snackbarHostState) {
                ch.brickinventoryapp.ui.ScrollPositionKeeper(
                    "parts", partsGridState,
                    // Beide Ladevorgänge, nicht nur die Set-Teile. `manualParts != null` heisst
                    // „die Antwort ist zurück“ — auch bei null manuell erfassten Teilen. Mit
                    // `isNotEmpty()` würde die Position bei jemandem ohne eigene Teile nie
                    // wiederhergestellt.
                    bereit = partsState.parts.isNotEmpty() && partsState.manualParts != null,
                    speicher = vm.scrollMemory,
                    obenNachziehend = partsState.manualParts?.size ?: 0)
                PartsScreen(
                    vm = teileVm,
                    imageLoader = imageLoader,
                    onOpenDetail = { partNumber, colorId ->
                        navController.navigate(Screen.ManualItemDetail.createRoute(
                            "part", partNumber, colorId,
                            partsState.manualParts
                                ?.find { it.partNumber == partNumber && it.colorId == colorId }
                                ?.partName ?: partNumber))
                    },
                    gridState = partsGridState
                )
                // ── Der Detail-Dialog für Teile aus Sets ──
                //
                // Hier und nicht im Bildschirm, weil nur der Graph den NavController kennt — wie
                // onOpenDetail darüber. Der Dialog zeigt sich nur, wenn im Zustand ein Teil offen
                // ist (SetItemUiState.offen).
                SetItemDetailDialog(
                    vm = teileVm,
                    imageLoader = imageLoader,
                    serverUrl = state.serverUrl,
                    onOpenSet = { navController.navigate(Screen.SetDetail.createRoute(it)) },
                )
            }
        }
        composable(Screen.Minifigs.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val teileVm: TeileViewModel = hiltViewModel()
            val state by teileVm.state.collectAsStateWithLifecycle()
            val partsState by teileVm.partsState.collectAsStateWithLifecycle()
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) { if (partsState.minifigs.isEmpty()) teileVm.loadMinifigs() } }
            ReiterGeruest(stringResource(R.string.nav_minifigs), vm, navController, bottomNavItems, snackbarHostState) {
                ch.brickinventoryapp.ui.ScrollPositionKeeper(
                    "minifigs", minifigsGridState,
                    // Auf abgeschlossen statt auf Inhalt prüfen, wie bei den Teilen: Sonst bekäme,
                    // wer keine manuell erfassten Minifiguren hat, nie eine Position
                    // wiederhergestellt.
                    bereit = partsState.minifigs.isNotEmpty() && partsState.manualFigs != null,
                    speicher = vm.scrollMemory,
                    obenNachziehend = partsState.manualFigs?.size ?: 0)
                MinifigsScreen(
                    vm = teileVm,
                    imageLoader = imageLoader,
                    onOpenDetail = { figNumber ->
                        navController.navigate(Screen.ManualItemDetail.createRoute(
                            "fig", figNumber, 0,
                            partsState.manualFigs?.find { it.figNumber == figNumber }
                                ?.figName ?: figNumber))
                    },
                    gridState = minifigsGridState
                )
                // Derselbe Dialog wie im Teile-Reiter — er unterscheidet
                // Teile und Figuren selbst ueber SetItemUiState.art.
                SetItemDetailDialog(
                    vm = teileVm,
                    imageLoader = imageLoader,
                    serverUrl = state.serverUrl,
                    onOpenSet = { navController.navigate(Screen.SetDetail.createRoute(it)) },
                )
            }
        }
        composable(Screen.Comparison.route) {
            ReiterGeruest(stringResource(R.string.nav_comparison), vm, navController, bottomNavItems, snackbarHostState) {
                ComparisonScreen()
            }
        }
        // ── Detailansicht manueller Teile und Minifiguren ────────────────────
        // Ein ganzer Screen, kein Dialog mehr — Aufbau wie beim Set-Detail.
        composable(
            route = Screen.ManualItemDetail.route,
            arguments = listOf(
                androidx.navigation.navArgument("type")    { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("id")      { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("colorId") { type = androidx.navigation.NavType.IntType; defaultValue = 0 },
                androidx.navigation.navArgument("title")   { type = androidx.navigation.NavType.StringType }
            )
        ) { backStackEntry ->
            val itemType  = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("type") ?: "part", "UTF-8")
            val itemId    = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("id")   ?: "",     "UTF-8")
            val colorId   = backStackEntry.arguments?.getInt("colorId") ?: 0
            val itemTitle = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("title") ?: "",    "UTF-8")
            ManualItemDetailScreen(
                vm = hiltViewModel<KaeufeViewModel>(),
                teile = hiltViewModel(),
                type = itemType,
                id = itemId,
                colorId = colorId,
                fallbackTitle = itemTitle,
                imageLoader = imageLoader,
                onBack = { navController.popBackStack() },
                onNavigateToAcqMgmt = { t, i, c, title ->
                    navController.navigate(Screen.AcquisitionManagement.createRoute(t, i, c, title))
                },
                // Die Farbe ist Teil der Route (manual_detail/.../{colorId}/...) und der Suche im
                // Screen; nach einer Änderung muss er mit der neuen Farbe neu geöffnet werden,
                // sonst sucht er eine Zeile, die es nicht mehr gibt. Erst zurück, dann hin: Sonst
                // landete ein Zurück-Tipp auf genau der Farbe, die gerade korrigiert wurde.
                onFarbeGeaendert = { neueFarbe ->
                    navController.popBackStack()
                    navController.navigate(Screen.ManualItemDetail.createRoute(
                        itemType, itemId, neueFarbe, itemTitle))
                },
            )
        }

        composable(
            route = Screen.AcquisitionManagement.route,
            arguments = listOf(
                androidx.navigation.navArgument("type")    { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("id")      { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("colorId") { type = androidx.navigation.NavType.IntType; defaultValue = 0 },
                androidx.navigation.navArgument("title")   { type = androidx.navigation.NavType.StringType }
            )
        ) { backStackEntry ->
            val itemType  = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("type")    ?: "set", "UTF-8")
            val itemId    = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("id")      ?: "",    "UTF-8")
            val colorId   = backStackEntry.arguments?.getInt("colorId") ?: 0
            val itemTitle = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("title")   ?: "",    "UTF-8")
            AcquisitionManagementScreen(
                vm      = hiltViewModel<KaeufeViewModel>(),
                type    = itemType,
                id      = itemId,
                colorId = colorId,
                title   = itemTitle,
                onBack  = { navController.popBackStack() }
            )
        }
}
