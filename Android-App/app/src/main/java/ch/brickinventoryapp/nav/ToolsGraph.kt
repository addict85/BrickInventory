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
    gutscheinVm: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel,
    navController: NavHostController,
    imageLoader: coil3.ImageLoader,
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
    /**
     * Rollposition der Einstellungen — von aussen, seit die Preisalarm-Rubrik
     * in die Detailansicht eines Sets fuehrt. Ohne das stuende man nach der
     * Rueckkehr wieder ganz oben, und die Rubrik liegt weit unten.
     */
    settingsScrollState: androidx.compose.foundation.ScrollState,
) {
        composable(Screen.Finance.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val financeState by vm.financeState.collectAsStateWithLifecycle()
            val partsState by vm.partsState.collectAsStateWithLifecycle()
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
                        // Aus DERSELBEN Quelle wie die Listen. Ist sie noch
                        // nicht geladen, steht die Nummer da — genau wie
                        // vorher, wenn die Bewertung noch fehlte.
                        val name = if (type == "fig")
                            partsState.manualFigs?.find { it.figNumber == id }?.figName
                        else
                            partsState.manualParts
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
                    onLadeBestand = { teile, nurLose, mitUnterkonten ->
                        vm.ladeTeilelisteBestand(teile, nurLose, mitUnterkonten) },
                    // Dieselbe Regel wie in der Webapp (02-gallery.js): Mehr als
                    // ein Mitglied im Haushalt heisst „es gibt Unterkonten".
                    hatUnterkonten = state.householdMembers.size > 1,
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
            //
            // Hier stand bis zum 16.10. auch das Laden von Haushalt,
            // Gutscheinen, Profil und Geraeten. Es ist mit den Rubriken
            // umgezogen: Jede Unterseite holt, was SIE zeigt, und zwar wenn
            // man sie oeffnet. Wer die Sprache umstellt, braucht keine
            // Gutscheinliste.
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) vm.loadSettings() }
            ReiterGeruest(stringResource(R.string.nav_settings), vm, navController, bottomNavItems, snackbarHostState) {
                ch.brickinventoryapp.ui.ScrollPositionKeeper(
                    "settings", settingsScrollState, vm.scrollMemory)
                SettingsScreen(
                    vm = vm,
                    onLogout = { vm.logout(); navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } } },
                    onServerWechseln = { navController.navigate(Screen.Setup.route) },
                    // Die sechs Rubriken fuehren seit dem 17.10. nicht mehr
                    // von hier aus weiter: Sie stehen in der Konto-Klappe
                    // (MainScaffold.kt), eine Ebene weiter aussen. Mit ihnen
                    // sind `onUnterseite` und EinstellungsBereich entfallen —
                    // ein Parameter, den niemand mehr fuellt, waere sonst der
                    // naechste tote Pfad.
                    scrollState = settingsScrollState,
                )
            }
        }

        // ── Die Unterseiten der Einstellungen ───────────────────────────────
        //
        // Marcos Befund vom 16.10.: „Generell wirkt dieser Dialog überladen
        // […] Evtl. Auch Elemente aus den Einstellungen in eine eigene Sicht
        // verschieben?" — sechs Rubriken, sechs Seiten.
        //
        // OHNE ReiterGeruest: Eine Unterseite traegt einen Zurueck-Pfeil, keine
        // untere Leiste. Sie bringt ihren Snackbar-Halter selbst mit (siehe
        // EinstellungenUnterseiten.kt); sonst gingen die Meldungen des
        // ViewModels dort verloren.
        composable(Screen.Gutscheine.route) {
            val state by vm.state.collectAsStateWithLifecycle()
            val gutscheine by gutscheinVm.state.collectAsStateWithLifecycle()
            // Ein angetipptes Gutschein-PDF: Das Ziel steht im Zustand, die
            // Navigation macht der Graph. Der Betrachter ist der vorhandene
            // PdfViewerScreen — er laedt die Adresse mit dem angemeldeten
            // Client der App und kann drucken und speichern.
            LaunchedEffect(gutscheine.pdfZiel) {
                val id = gutscheine.pdfZiel ?: return@LaunchedEffect
                val nummer = gutscheine.gutscheine.find { it.id == id }?.number.orEmpty()
                navController.navigate(Screen.PdfViewer.createRoute(
                    ch.brickinventoryapp.ui.viewmodel.gutscheinPdfAdresse(state.serverUrl, id), nummer))
                gutscheinVm.gutscheinPdfQuittieren()
            }
            // Dasselbe fuer den Export ALLER Gutscheine. Der Titel wird
            // AUSSERHALB des LaunchedEffect gelesen: stringResource ist
            // @Composable und in einem Effekt nicht aufrufbar.
            val exportTitel = stringResource(R.string.vouchers_export)
            LaunchedEffect(gutscheine.exportZeigen) {
                if (!gutscheine.exportZeigen) return@LaunchedEffect
                navController.navigate(Screen.PdfViewer.createRoute(
                    ch.brickinventoryapp.ui.viewmodel.gutscheinExportAdresse(state.serverUrl), exportTitel))
                gutscheinVm.gutscheinExportQuittieren()
            }
            GutscheineUnterseite(gutscheinVm, snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Preisalarme.route) {
            val state by vm.state.collectAsStateWithLifecycle()
            PreisalarmeUnterseite(
                vm = vm,
                imageLoader = imageLoader,
                serverUrl = state.serverUrl,
                snackbarHostState = snackbarHostState,
                // Dieselbe Detailansicht wie aus Galerie und Finanzen — ein
                // zweiter Weg dorthin waere ein zweiter Ort fuer dieselben
                // Regeln.
                onSetClick = { navController.navigate(Screen.SetDetail.createRoute(it)) },
                onZurueck = { navController.popBackStack() },
            )
        }

        composable(Screen.Lagerorte.route) {
            LagerorteUnterseite(vm, snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Haushalt.route) {
            HaushaltUnterseite(vm, snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.CsvImport.route) {
            CsvImportUnterseite(vm, snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Konto.route) {
            KontoUnterseite(vm, snackbarHostState) { navController.popBackStack() }
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
