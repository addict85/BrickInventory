package ch.brickinventoryapp.app.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.anmeldung.ui.*
import ch.brickinventoryapp.finanzen.ui.*
import ch.brickinventoryapp.katalog.ui.*
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.verwaltung.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.anmeldung.ui.screens.*
import ch.brickinventoryapp.finanzen.ui.screens.*
import ch.brickinventoryapp.katalog.ui.screens.*
import ch.brickinventoryapp.konto.ui.screens.*
import ch.brickinventoryapp.sammlung.ui.screens.*
import ch.brickinventoryapp.teile.ui.screens.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.verwaltung.ui.screens.*
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraphBuilder
import ch.brickinventoryapp.app.*
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.HaushaltViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.toRoute
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.Schrittsperre
import ch.brickinventoryapp.finanzen.ui.screens.GutscheinPdfSchutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.finanzen.ui.viewmodel.gutscheinPdfAdresse

/** Navigationsziele der Werkzeuge, von „Mehr“ und der Einstellungen. */
fun NavGraphBuilder.toolsGraph(u: ZielUmgebung) {
    finanzZiele(u)
    mehrZiele(u)
    verwaltungsZiele(u)
    einstellungsZiele(u)
}

/** Finanzen, Scanner und PDF-Betrachter: von mehreren Seiten aus erreichbar. */
private fun NavGraphBuilder.finanzZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    val financeListState = u.rollen.finanzen
    composable<Screen.Finance> {
        val vm = u.aktivitaet.app
        val finanzen: FinanzViewModel = hiltViewModel()
        val state by finanzen.state.collectAsStateWithLifecycle()
        val financeState by finanzen.financeState.collectAsStateWithLifecycle()
        LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank() && financeState.valuation == null) finanzen.loadValuation() }
        ReiterGeruest(stringResource(R.string.nav_finance), u) {
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank() && financeState.historyPoints.isEmpty()) finanzen.loadPortfolioHistory()
            }
            ScrollPositionKeeper(
                Screen.Finance.rollSchluessel, financeListState,
                financeState.valuation != null, vm.scrollMemory)
            FinanceRoute(
                vm = finanzen,
                imageLoader = imageLoader,
                // Klick auf eine Zeile öffnet dieselbe Detailansicht wie in der Galerie. Der
                // Scroll-Zustand liegt ausserhalb (financeListState), damit die Rückkehr an
                // derselben Stelle landet.
                onSetClick = { navController.navigate(Screen.SetDetail(it)) },
                // Den Namen gibt die angeklickte Zeile mit, sonst stünde bis zum ersten
                // Laden die nackte Nummer in der Leiste.
                onManualClick = { type, id, colorId, name ->
                    navController.navigate(Screen.ManualItemDetail(Postenart.aus(type), id, colorId, name ?: id))
                },
                listState = financeListState
            )
        }
    }
    composable<Screen.BarcodeScanner> {
        val erfassung = u.aktivitaet.erfassung
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
    composable<Screen.PdfViewer> { backStackEntry ->
        val ziel = backStackEntry.toRoute<Screen.PdfViewer>()
        GutscheinPdfSchutz(ziel.url)
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        PdfViewerRoute(
            pdfUrl = ziel.url,
            title  = ziel.title,
            serverUrl = state.serverUrl,
            onBack = { navController.popBackStack() }
        )
    }
}

/** Die Seiten mit unterer Leiste, die über „Mehr“ erreichbar sind. */
private fun NavGraphBuilder.mehrZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    val partsListState = u.rollen.teileliste
    composable<Screen.PartsList> {
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        val blick by vm.blickfeld.collectAsStateWithLifecycle()
        val erfassung = u.aktivitaet.erfassung
        val barcodeState by erfassung.barcodeState.collectAsStateWithLifecycle()
        ReiterGeruest(stringResource(R.string.nav_partslist), u) {
            PartsListRoute(
                serverUrl = state.serverUrl,
                imageLoader = imageLoader,
                onScanBarcode = { erfassung.setScannerSource("partslist"); navController.navigate(Screen.BarcodeScanner) },
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
    composable<Screen.Mehr> {
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        val selbstUpdate = u.aktivitaet.update
        val update by selbstUpdate.updateState.collectAsStateWithLifecycle()
        ReiterGeruest(stringResource(R.string.nav_more), u) {
            MehrBildschirm(
                onZiel = navController::oeffneVonMehr,
                isAdmin = state.isAdmin,
                updateVerfuegbar = update.neuereFassung != null,
                onAbmelden = {
                    vm.logout()
                    navController.navigate(Screen.Login) { popUpTo(0) { inclusive = true } }
                },
            )
        }
    }
}

/** Einstellungen und Verwaltung, ebenfalls über „Mehr“. */
private fun NavGraphBuilder.verwaltungsZiele(u: ZielUmgebung) {
    val navController = u.navController
    val settingsScrollState = u.rollen.einstellungen
    composable<Screen.Settings> {
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        // Beim Öffnen der Einstellungen laden: Der Zustand ändert sich ausserhalb kaum,
        // ein Dauerabo wäre Aufwand ohne Nutzen. Haushalt, Gutscheine, Profil und Geräte
        // holt jede Unterseite selbst, wenn man sie öffnet — wer die Sprache umstellt,
        // braucht keine Gutscheinliste.
        LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) vm.loadSettings() }
        ReiterGeruest(stringResource(R.string.nav_settings), u) {
            ScrollPositionKeeper(
                Screen.Settings.rollSchluessel, settingsScrollState, vm.scrollMemory)
            SettingsRoute(
                vm = hiltViewModel<EinstellungenViewModel>(),
                onLogout = { vm.logout(); navController.navigate(Screen.Login) { popUpTo(0) { inclusive = true } } },
                onServerWechseln = { navController.navigate(Screen.Setup) },
                // Die Rubriken führen nicht von hier weiter, sondern stehen auf „Mehr“
                // (MehrBildschirm.kt).
                scrollState = settingsScrollState,
                selbstUpdate = u.aktivitaet.update,
                darstellung = u.aktivitaet.darstellung,
                vertrauen = u.aktivitaet.vertrauen,
            )
        }
    }

    composable<Screen.Monitoring> {
        // Fällt das Verwalterrecht weg, verlässt die Seite sich selbst, statt weiter 403 zu sammeln.
        val vm = u.aktivitaet.app
        val stand by vm.state.collectAsStateWithLifecycle()
        LaunchedEffect(stand.isAdmin) { if (!stand.isAdmin) navController.popBackStack() }
        ReiterGeruest(stringResource(R.string.nav_monitoring), u) {
            // Verwalteraktionen nur nach der Gerätesperre; kein Tipp durch eine Überlagerung.
            Ueberdeckungsschutz()
            Schrittsperre(stringResource(R.string.schritt_verwaltung)) {
                MonitoringRoute(appTheme = stand.appTheme, onEinstellungenNeu = { vm.loadSettings() })
            }
        }
    }
}

/**
 * Die Unterseiten der Einstellungen, ohne ReiterGeruest: Eine Unterseite trägt einen
 * Zurück-Pfeil, keine untere Leiste, und bringt ihren Snackbar-Halter selbst mit.
 */
private fun NavGraphBuilder.einstellungsZiele(u: ZielUmgebung) {
    val navController = u.navController
    val snackbarHostState = u.snackbarHostState
    composable<Screen.Gutscheine> {
        val vm = u.aktivitaet.app
        // An der Activity: Eine Guthabenabfrage über alle Karten läuft weiter, wenn
        // man die Seite verlässt.
        val gutscheinVm = u.aktivitaet.gutschein
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
            navController.navigate(Screen.PdfViewer(
                gutscheinPdfAdresse(state.serverUrl, ziel), titel))
            gutscheinVm.gutscheinPdfQuittieren()
        }
        GutscheineRoute(gutscheinVm, snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.Preisalarme> {
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        PreisalarmeRoute(
            vm = hiltViewModel<EinstellungenViewModel>(),
            imageLoader = u.imageLoader,
            serverUrl = state.serverUrl,
            snackbarHostState = snackbarHostState,
            // Dieselbe Detailansicht wie aus Galerie und Finanzen — ein
            // zweiter Weg dorthin waere ein zweiter Ort fuer dieselben
            // Regeln.
            onSetClick = { navController.navigate(Screen.SetDetail(it)) },
            onZurueck = { navController.popBackStack() },
        )
    }

    composable<Screen.Lagerorte> {
        LagerorteRoute(hiltViewModel<EinstellungenViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.Haushalt> {
        HaushaltRoute(hiltViewModel<HaushaltViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.CsvImport> {
        CsvImportRoute(hiltViewModel<EinstellungenViewModel>(), snackbarHostState) { navController.popBackStack() }
    }

    composable<Screen.Konto> {
        KontoRoute(snackbarHostState) { navController.popBackStack() }
    }
}
