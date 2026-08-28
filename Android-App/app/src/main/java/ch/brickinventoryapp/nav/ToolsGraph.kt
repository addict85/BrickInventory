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
fun NavGraphBuilder.toolsGraph(
    vm: MainViewModel,
    navController: NavHostController,
    imageLoader: coil.ImageLoader,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
    activity: android.content.Context,
    /**
     * Scroll-Zustand der Finanz-Liste. Wird ausserhalb des Ziels gehalten, weil
     * das Ziel beim Öffnen der Detailansicht verworfen wird — ein
     * rememberLazyListState() darin ginge dabei verloren und die Liste spränge
     * bei der Rückkehr nach oben.
     *
     * Anders als beim Zustand aus dem ViewModel ist das unbedenklich: Hier wird
     * eine stabile Objektreferenz durchgereicht, kein abgelesener Wert.
     */
    financeListState: androidx.compose.foundation.lazy.LazyListState,
    /**
     * Scroll-Zustand der Teileliste — aus demselben Grund von aussen: Der Weg
     * zum Barcode-Scanner führt aus diesem Bildschirm HERAUS (siehe Nachtrag 64,
     * wo an derselben Stelle die gesammelten Sets verschwanden).
     */
    partsListState: androidx.compose.foundation.lazy.LazyListState,
) {
        composable(Screen.Finance.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val financeState by vm.financeState.collectAsStateWithLifecycle()
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank() && financeState.valuation == null) vm.loadValuation() }
            ReiterGeruest(stringResource(R.string.nav_finance), vm, navController, bottomNavItems, snackbarHostState) {
                LaunchedEffect(state.serverUrl) {
                    if (state.serverUrl.isNotBlank() && financeState.historyPoints.isEmpty()) vm.loadPortfolioHistory()
                }
                ch.brickinventoryapp.ui.ScrollPositionKeeper(
                    "finance", financeListState,
                    financeState.valuation != null, vm.scrollMemory)
                FinanceScreen(
                    vm = vm,
                    imageLoader = imageLoader,
                    // Klick auf eine Zeile öffnet dieselbe Detailansicht wie in
                    // der Galerie. Der Scroll-Zustand liegt ausserhalb dieses
                    // Ziels (financeListState), damit die Rückkehr wieder an
                    // derselben Stelle landet — beim Verlassen wird das Ziel
                    // verworfen und ein rememberLazyListState() darin wäre weg.
                    onSetClick = { navController.navigate(Screen.SetDetail.createRoute(it)) },
                    // Wie beim Set: ein ganzer Screen, kein Dialog. Den Namen
                    // für die Leiste kennt die Bewertung, die diese Liste
                    // ohnehin geladen hat — sonst stünde dort bis zum ersten
                    // Laden die nackte Nummer.
                    onManualClick = { type, id, colorId ->
                        val name = if (type == "fig")
                            financeState.figsValuation?.figs?.find { it.figNumber == id }?.figName
                        else
                            financeState.partsValuation?.parts
                                ?.find { it.partNumber == id && it.colorId == colorId }?.partName
                        navController.navigate(
                            Screen.ManualItemDetail.createRoute(type, id, colorId, name ?: id))
                    },
                    listState = financeListState
                )

            }
        }
        composable(Screen.BarcodeScanner.route) {
            BarcodeScannerScreen(
                // Texterkennung nur hier (Nachtrag 61): Dieser Scanner bedient
                // „Set hinzufügen" (Galerie) und „Teileliste hinzufügen" —
                // genau Marcos zwei Stellen. Der Preisvergleich hat einen
                // eigenen Aufruf und lässt den Standard AUS.
                ocrEnabled = true,
                onResult = { scannedValue ->
                    navController.popBackStack()
                    // Look up the scanned value via barcode API then navigate to add set
                    vm.resolveBarcode(scannedValue)
                },
                // Texterkennung liefert die Setnummer bereits fertig (Nachtrag
                // 60) — der Umweg über die EAN-Auflösung entfällt. Das spart je
                // Scan bis zu acht Rebrickable-Aufrufe und geht sofort weiter.
                onSetNumberResult = { setNumber ->
                    navController.popBackStack()
                    vm.useScannedSetNumber(setNumber)
                },
                onDismiss = { navController.popBackStack() }
            )
        }
        composable(Screen.PartsList.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()
            ReiterGeruest(stringResource(R.string.nav_partslist), vm, navController, bottomNavItems, snackbarHostState) {
                PartsListScreen(
                    serverUrl = state.serverUrl,
                    authToken = state.authToken,
                    onExportPdf = { sets, parts -> vm.exportPartsPdf(activity, sets, parts) },
                    pdfStatus = vm.pdfExportStatus,
                    imageLoader = imageLoader,
                    onScanBarcode = { vm.setScannerSource("partslist"); navController.navigate(Screen.BarcodeScanner.route) },
                    // Erfolgloser Scan → Cursor ins Set-Feld (Nachtrag 113).
                    manuelleErfassungAnfordern = barcodeState.manuelleErfassungAnfordern,
                    onManuelleErfassungQuittiert = { vm.manuelleErfassungQuittieren() },
                    onResolveSet = { setNumber -> vm.resolveSetForPartsList(setNumber) },
                    barcodeSetNumber = barcodeState.fuerTeileliste,
                    onBarcodeConsumed = { vm.clearBarcodeForPartsList() },
                    listState = partsListState
                )
            }
        }
        composable(Screen.Settings.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            // Beim Öffnen der Einstellungen laden: Der Zustand ändert sich
            // ausserhalb dieser Ansicht kaum, und ein Dauerabo dafür wäre
            // Aufwand ohne Nutzen.
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) vm.loadHouseholdStatus() }
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) vm.loadSettings() }
            ReiterGeruest(stringResource(R.string.nav_settings), vm, navController, bottomNavItems, snackbarHostState) {
                SettingsScreen(
                    vm = vm,
                    onLogout = { vm.logout(); navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } } },
                )
            }
        }
        composable(Screen.Monitoring.route) {
            ReiterGeruest(stringResource(R.string.nav_monitoring), vm, navController, bottomNavItems, snackbarHostState) {
                MonitoringScreen(vm)
            }
        }
        composable(
            route = Screen.PdfViewer.route,
            arguments = listOf(
                androidx.navigation.navArgument("url")   { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("title") { type = androidx.navigation.NavType.StringType }
            )
        ) { backStackEntry ->
            val pdfUrl   = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("url")   ?: "", "UTF-8")
            val pdfTitle = java.net.URLDecoder.decode(backStackEntry.arguments?.getString("title") ?: "", "UTF-8")
            PdfViewerScreen(
                pdfUrl = pdfUrl,
                title  = pdfTitle,
                httpClient = vm.apiHttpClient,
                onBack = { navController.popBackStack() }
            )
        }
}
