package ch.brickinventoryapp.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import coil3.ImageLoader
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import ch.brickinventoryapp.*
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.HaushaltViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel

/**
 * Navigationsziele der Werkzeug-Reiter. Die Werte, die die Ziele aus AppNavigation
 * brauchen, kommen als Parameter herein, damit kein Ziel Zustand aus einem
 * umgebenden Scope einfängt.
 */
fun NavGraphBuilder.toolsGraph(
    vm: AppViewModel,
    gutscheinVm: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel,
    navController: NavHostController,
    imageLoader: coil3.ImageLoader,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
    /**
     * Scroll-Zustand der Finanz-Liste. Ausserhalb des Ziels gehalten, weil das Ziel
     * beim Öffnen der Detailansicht verworfen wird — ein rememberLazyListState() darin
     * ginge verloren, die Liste spränge nach oben. Unbedenklich, weil eine stabile
     * Objektreferenz durchgereicht wird, kein abgelesener Wert.
     */
    financeListState: androidx.compose.foundation.lazy.LazyListState,
    /**
     * Scroll-Zustand der Teileliste — aus demselben Grund von aussen: Der Weg zum
     * Barcode-Scanner führt aus diesem Bildschirm heraus.
     */
    partsListState: androidx.compose.foundation.lazy.LazyListState,
    /**
     * Rollposition der Einstellungen — von aussen, weil die Preisalarm-Rubrik in die
     * Detailansicht eines Sets führt; sonst stünde man nach der Rückkehr ganz oben.
     */
    settingsScrollState: androidx.compose.foundation.ScrollState,
) {
        composable(Screen.Finance.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val finanzen: FinanzViewModel = hiltViewModel()
            val state by finanzen.state.collectAsStateWithLifecycle()
            val financeState by finanzen.financeState.collectAsStateWithLifecycle()
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank() && financeState.valuation == null) finanzen.loadValuation() }
            ReiterGeruest(stringResource(R.string.nav_finance), vm, navController, bottomNavItems, snackbarHostState) {
                LaunchedEffect(state.serverUrl) {
                    if (state.serverUrl.isNotBlank() && financeState.historyPoints.isEmpty()) finanzen.loadPortfolioHistory()
                }
                ch.brickinventoryapp.ui.ScrollPositionKeeper(
                    "finance", financeListState,
                    financeState.valuation != null, vm.scrollMemory)
                FinanceScreen(
                    vm = finanzen,
                    imageLoader = imageLoader,
                    // Klick auf eine Zeile öffnet dieselbe Detailansicht wie in der Galerie. Der
                    // Scroll-Zustand liegt ausserhalb (financeListState), damit die Rückkehr an
                    // derselben Stelle landet.
                    onSetClick = { navController.navigate(Screen.SetDetail.createRoute(it)) },
                    // Wie beim Set: ein ganzer Screen, kein Dialog. Den Namen gibt die angeklickte
                    // Zeile mit, sonst stünde bis zum ersten Laden die nackte Nummer in der Leiste;
                    // die manuellen Stücke haben ausserhalb der Finanzen eine eigene Quelle
                    // (test/manuell-zustand-eine-regel-db.test.js).
                    onManualClick = { type, id, colorId, name ->
                        navController.navigate(
                            Screen.ManualItemDetail.createRoute(type, id, colorId, name ?: id))
                    },
                    listState = financeListState
                )
            }
        }
        composable(Screen.BarcodeScanner.route) {
            val erfassung = ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel<ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel>()
            BarcodeScannerScreen(
                // Texterkennung nur hier: Dieser Scanner bedient „Set hinzufügen“ (Galerie) und
                // „Teileliste hinzufügen“. Der Preisvergleich hat einen eigenen Aufruf und lässt
                // den Standard aus.
                ocrEnabled = true,
                onResult = { scannedValue ->
                    navController.popBackStack()
                    // Look up the scanned value via barcode API then navigate to add set
                    erfassung.resolveBarcode(scannedValue)
                },
                // Die Texterkennung liefert die Setnummer fertig — der Umweg über die
                // EAN-Auflösung entfällt, das spart je Scan bis zu acht Rebrickable-Aufrufe.
                onSetNumberResult = { setNumber ->
                    navController.popBackStack()
                    erfassung.useScannedSetNumber(setNumber)
                },
                onDismiss = { navController.popBackStack() }
            )
        }
        composable(Screen.PartsList.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            val blick by vm.blickfeld.collectAsStateWithLifecycle()
            val erfassung = ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel<ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel>()
            val barcodeState by erfassung.barcodeState.collectAsStateWithLifecycle()
            ReiterGeruest(stringResource(R.string.nav_partslist), vm, navController, bottomNavItems, snackbarHostState) {
                PartsListRoute(
                    serverUrl = state.serverUrl,
                    imageLoader = imageLoader,
                    onScanBarcode = { erfassung.setScannerSource("partslist"); navController.navigate(Screen.BarcodeScanner.route) },
                    // Erfolgloser Scan → Cursor ins Set-Feld.
                    manuelleErfassungAnfordern = barcodeState.manuelleErfassungAnfordern,
                    onManuelleErfassungQuittiert = { erfassung.manuelleErfassungQuittieren() },
                    // Dieselbe Regel wie in der Webapp (02-gallery.js): Mehr als
                    // ein Mitglied im Haushalt heisst „es gibt Unterkonten".
                    hatUnterkonten = blick.householdMembers.size > 1,
                    barcodeSetNumber = barcodeState.fuerTeileliste,
                    onBarcodeConsumed = { erfassung.clearBarcodeForPartsList() },
                    listState = partsListState
                )
            }
        }
        composable(Screen.Mehr.route) {
            val state by vm.state.collectAsStateWithLifecycle()
            val selbstUpdate: ch.brickinventoryapp.ui.viewmodel.UpdateViewModel = ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel()
            val update by selbstUpdate.updateState.collectAsStateWithLifecycle()
            ReiterGeruest(stringResource(R.string.nav_more), vm, navController, bottomNavItems, snackbarHostState) {
                MehrBildschirm(
                    navController = navController,
                    isAdmin = state.isAdmin,
                    updateVerfuegbar = update.neuereFassung != null,
                    onAbmelden = {
                        vm.logout()
                        navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } }
                    },
                )
            }
        }
        composable(Screen.Settings.route) {
            // Zustand INNERHALB des Ziels lesen — als Parameter wäre es eine
            // Momentaufnahme vom Aufbau des Graphen (der NavHost-Builder läuft nur einmal).
            val state by vm.state.collectAsStateWithLifecycle()
            // Beim Öffnen der Einstellungen laden: Der Zustand ändert sich ausserhalb kaum,
            // ein Dauerabo wäre Aufwand ohne Nutzen. Haushalt, Gutscheine, Profil und Geräte
            // holt jede Unterseite selbst, wenn man sie öffnet — wer die Sprache umstellt,
            // braucht keine Gutscheinliste.
            LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) vm.loadSettings() }
            ReiterGeruest(stringResource(R.string.nav_settings), vm, navController, bottomNavItems, snackbarHostState) {
                ch.brickinventoryapp.ui.ScrollPositionKeeper(
                    "settings", settingsScrollState, vm.scrollMemory)
                SettingsScreen(
                    vm = hiltViewModel<EinstellungenViewModel>(),
                    onLogout = { vm.logout(); navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } } },
                    onServerWechseln = { navController.navigate(Screen.Setup.route) },
                    // Die Rubriken führen nicht von hier weiter, sondern stehen auf „Mehr“
                    // (MehrBildschirm.kt).
                    scrollState = settingsScrollState,
                )
            }
        }

        // ── Die Unterseiten der Einstellungen ──
        //
        // Sechs Rubriken, sechs Seiten, ohne ReiterGeruest: Eine Unterseite trägt einen
        // Zurück-Pfeil, keine untere Leiste. Sie bringt ihren Snackbar-Halter selbst mit
        // (siehe EinstellungenUnterseiten.kt), sonst gingen die Meldungen dort verloren.
        composable(Screen.Gutscheine.route) {
            val state by vm.state.collectAsStateWithLifecycle()
            val gutscheine by gutscheinVm.state.collectAsStateWithLifecycle()
            // Ein freigegebenes Gutschein-PDF (eines oder alle): Das Ziel mit Ticket
            // steht im Zustand, die Navigation macht der Graph. Der Betrachter ist der
            // vorhandene PdfViewerScreen mit dem angemeldeten Client der App. Der Titel
            // wird AUSSERHALB des LaunchedEffect gelesen: stringResource ist @Composable.
            val exportTitel = stringResource(R.string.vouchers_export)
            LaunchedEffect(gutscheine.pdfZiel) {
                val ziel = gutscheine.pdfZiel ?: return@LaunchedEffect
                val titel = if (ziel.id == null) exportTitel
                    else gutscheine.gutscheine.find { it.id == ziel.id }?.number.orEmpty()
                navController.navigate(Screen.PdfViewer.createRoute(
                    ch.brickinventoryapp.ui.viewmodel.gutscheinPdfAdresse(state.serverUrl, ziel), titel))
                gutscheinVm.gutscheinPdfQuittieren()
            }
            GutscheineUnterseite(gutscheinVm, snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Preisalarme.route) {
            val state by vm.state.collectAsStateWithLifecycle()
            PreisalarmeUnterseite(
                vm = hiltViewModel<EinstellungenViewModel>(),
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
            LagerorteUnterseite(hiltViewModel<EinstellungenViewModel>(), snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Haushalt.route) {
            HaushaltUnterseite(hiltViewModel<HaushaltViewModel>(), snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.CsvImport.route) {
            CsvImportUnterseite(hiltViewModel<EinstellungenViewModel>(), snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Konto.route) {
            KontoUnterseite({ vm.logout() }, snackbarHostState) { navController.popBackStack() }
        }

        composable(Screen.Monitoring.route) {
            // Fällt das Verwalterrecht weg, verlässt die Seite sich selbst, statt weiter 403 zu sammeln.
            val stand by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(stand.isAdmin) { if (!stand.isAdmin) navController.popBackStack() }
            ReiterGeruest(stringResource(R.string.nav_monitoring), vm, navController, bottomNavItems, snackbarHostState) {
                // Verwalteraktionen nur nach der Gerätesperre; kein Tipp durch eine Überlagerung.
                ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
                ch.brickinventoryapp.ui.components.Schrittsperre(stringResource(R.string.schritt_verwaltung)) {
                    MonitoringScreen(vm)
                }
            }
        }
        composable(
            route = Screen.PdfViewer.route,
            arguments = pdfArgumente,
        ) { backStackEntry ->
            val pdfUrl   = backStackEntry.textArgument("url")
            val pdfTitle = backStackEntry.textArgument("title")
            if (ch.brickinventoryapp.ui.viewmodel.zeigtGutscheine(pdfUrl)) ch.brickinventoryapp.ui.components.Sichtschutz()
            val state by vm.state.collectAsStateWithLifecycle()
            PdfViewerRoute(
                pdfUrl = pdfUrl,
                title  = pdfTitle,
                serverUrl = state.serverUrl,
                onBack = { navController.popBackStack() }
            )
        }
}
