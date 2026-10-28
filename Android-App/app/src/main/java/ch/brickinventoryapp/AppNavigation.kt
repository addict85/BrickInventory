package ch.brickinventoryapp

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.nav.authGraph
import ch.brickinventoryapp.nav.collectionGraph
import ch.brickinventoryapp.nav.catalogGraph
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.nav.toolsGraph
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import coil3.ImageLoader
import ch.brickinventoryapp.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

// Die Navigationsziele liegen seit der Aufteilung in nav/ (eigenes Paket).


/**
 * App-Navigation und Haupt-Gerüst: der NavHost mit allen Routen, die Dialoge, die
 * über jedem Bildschirm stehen, und das MainScaffold (TopBar/BottomBar). Im Paket
 * von MainActivity, damit sie sich ohne Import finden.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrickInventoryManagerApp(
    vm: AppViewModel,
    // Der Katalog haelt seinen Zustand selbst; die Activity haelt beide, damit
    // Liste und Detail dieselbe Instanz sehen (siehe CatalogViewModel).
    katalog: CatalogViewModel,
    gutscheine: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel,
    imageLoader: coil3.ImageLoader,
) {
    // collectAsStateWithLifecycle: Collection stoppt, wenn die App im
    // Hintergrund ist — kein unnötiges Recomposition-/State-Processing mehr.
    val state by vm.state.collectAsStateWithLifecycle()
    val erfassung: ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel = aktivitaetsViewModel()
    val barcodeState by erfassung.barcodeState.collectAsStateWithLifecycle()
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    // ── Scroll-Zustände oberhalb des NavHost ──
    //
    // Beim Öffnen einer Detailansicht wird das darunterliegende Ziel verworfen; ein
    // `rememberLazyListState()`/`rememberLazyGridState()` darin wäre bei der Rückkehr
    // zurückgesetzt. Hier oben bleibt der Zustand am Leben, weil diese Ebene beim
    // Navigieren nicht verlassen wird.
    //
    // Der Katalog ist nicht dabei: Seine Liste führt alle `total` Plätze und lädt
    // seitenweise, im Moment der Rückkehr sind noch keine Plätze da. Er merkt sich die
    // Position im ViewModel und springt zurück, sobald die Länge steht
    // (CatalogScreen.kt).
    val financeListState   = androidx.compose.foundation.lazy.rememberLazyListState()
    val galleryGridState   = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val partsGridState     = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val minifigsGridState  = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val partsListState     = androidx.compose.foundation.lazy.rememberLazyListState()
    // Die Einstellungen sind eine gewoehnliche scrollende Spalte, keine Liste —
    // seit die Preisalarm-Rubrik in die Set-Detailansicht fuehrt, braucht auch
    // sie ihren Zustand hier oben.
    val settingsScrollState = androidx.compose.foundation.rememberScrollState()

    // Snackbar aus eigenem Flow — Meldungen rekomponieren so nicht mehr den
    // gesamten Tree über AppUiState.
    val snackbarMsg by vm.snackbar.collectAsStateWithLifecycle()
    LaunchedEffect(snackbarMsg) {
        snackbarMsg?.let {
            snackbarHostState.showSnackbar(it)
            vm.clearSnackbar()
        }
    }

    // CSV-Import-Überwachung per persistenter SSE-Verbindung.
    // Wird einmal beim Login gestartet; der ViewModel-Scope hält sie am Leben
    // und reconnectet automatisch. repeatOnLifecycle ist nicht mehr nötig, weil
    // die Verbindung im Hintergrund weiterläuft (kein Polling, minimaler Overhead).
    LaunchedEffect(state.isLoggedIn) {
        if (state.isLoggedIn) {
            vm.startCsvImportWatcher()
            // ── Still nach einem Update sehen ──
            //
            // Beim Start prüfen, nie von allein laden: `still = true` ist ein kleiner
            // HTTPS-Abruf ohne Ladebalken und ohne Fehlermeldung — wer ohne Netz startet, soll
            // keine rote Zeile sehen; der Knopf in den Einstellungen meldet sehr wohl
            // (UpdateViewModel). Hier, weil die Frage der ganzen App gilt und nicht nur dem,
            // der in den Einstellungen sitzt.
            selbstUpdate.pruefeAufUpdate(still = true)
        }
    }

    // Beim Zurückkehren in den Vordergrund die Einstellungen neu laden — so
    // greift ein in der Webapp geänderter Standard-Zustand auch in einer
    // bereits laufenden App-Sitzung (loadSettings() lief sonst nur bei Login).
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, state.isLoggedIn) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && state.isLoggedIn) {
                vm.loadSettings()
                // Die Filterlisten mit: Scheiterte ihr einziger Abruf beim Start,
                // fehlten Konto- und Lagerortfilter sonst bis zum Neustart.
                vm.loadHouseholdMembers()
                vm.loadLagerorte()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val startDest = when {
        state.serverUrl.isBlank() -> Screen.Setup.route
        !state.isLoggedIn         -> Screen.Login.route
        else                      -> Screen.Gallery.route
    }

    // Nav-Labels hier auflösen (direkt im @Composable-Scope, nicht im remember-Lambda)
    val labelCollection = stringResource(R.string.nav_collection)
    val labelCatalog    = stringResource(R.string.nav_catalog)
    val labelPartslist  = stringResource(R.string.nav_partslist)
    val labelFinance    = stringResource(R.string.nav_finance)
    val labelWanted     = stringResource(R.string.nav_wanted)

    // Die fünf Ziele der Webapp — Material sieht höchstens fünf Reiter vor. Der
    // Vergleich steht im Konto-Menü (MainScaffold), Teile und Minifiguren im
    // Umschalter der Sammlung. Symbole ohne Beschreibung: Die Beschriftung steht
    // daneben, sonst liest TalkBack doppelt.
    val bottomNavItems = remember(labelCollection, labelCatalog, labelPartslist, labelFinance, labelWanted) {
        buildList<Triple<Screen, @Composable () -> Unit, String>> {
            add(Triple(Screen.Gallery,   { Icon(Icons.Default.ViewInAr, null) },               labelCollection))
            add(Triple(Screen.PartsList, { Icon(Icons.AutoMirrored.Filled.ListAlt, null) },     labelPartslist))
            add(Triple(Screen.Finance,   { Icon(Icons.AutoMirrored.Filled.ShowChart, null) },     labelFinance))
            // Merkliste VOR dem Katalog (Marcos Vorgabe), wie in der Webapp.
            add(Triple(Screen.Wanted,    { Icon(Icons.Default.StarBorder, null) },                 labelWanted))
            add(Triple(Screen.Catalog,   { Icon(Icons.AutoMirrored.Filled.MenuBook, null) },      labelCatalog))
        }
    }

    // ── Barcode-Bestätigung — über jedem Bildschirm ──
    // Der Dialog steht in ui/dialogs/BarcodeResultDialog.kt; hier nur, wann er erscheint.
    if (barcodeState.result != null) {
        ch.brickinventoryapp.ui.dialogs.BarcodeResultDialog(erfassung, imageLoader)
    }

    // ── „Wird geprüft“ — über allem, auch über dem Scanner-Weg ──
    // Hier, weil die Prüfung zu keinem einzelnen Bildschirm gehört: Sie beginnt im Scanner, der sich sofort schliesst, und läuft über Galerie, Teileliste oder Katalog weiter.
    ch.brickinventoryapp.ui.dialogs.SetPruefungDialog(erfassung)

    // ── „Es gibt eine neue Fassung“ — ebenfalls über allem ──
    //
    // Ein Hinweis beim Start mit Ja/Nein, weil ein Punkt in den Einstellungen leicht
    // übersehen wird. Hier, weil die Frage der ganzen App gilt; die auslösende Prüfung
    // steht ein paar Zeilen weiter oben.
    ch.brickinventoryapp.ui.dialogs.UpdateDialog(selbstUpdate)


    // ── Eine angetippte Preisalarm-Meldung öffnet ihr Set ──
    //
    // Hier und nicht in der Activity: Navigiert wird mit dem NavController, den es
    // erst in dieser Composition gibt; die Activity legt das Ziel nur in den Zustand
    // (MeldungsZielUiState).
    //
    // Nur angemeldet: Sonst landete man auf einem Set-Detail ohne Token, das nichts
    // laden kann. Das Ziel bleibt stehen und wird nach der Anmeldung eingelöst, weil
    // startDest dann auf Gallery wechselt und dieser Block erneut läuft.
    val meldungsZiel by vm.meldungsZiel.collectAsStateWithLifecycle()
    LaunchedEffect(meldungsZiel.setNummer, startDest) {
        val sn = meldungsZiel.setNummer
        if (sn != null && startDest == Screen.Gallery.route) {
            navController.navigate(Screen.SetDetail.createRoute(sn))
            // Sofort quittieren, sonst springt die App bei der naechsten
            // Rekomposition erneut — dieselbe Regel wie bei der manuellen
            // Erfassung nach einem erfolglosen Scan.
            vm.setAusMeldungQuittieren()
        }
    }

    val activity = androidx.compose.ui.platform.LocalContext.current
    NavHost(navController, startDestination = startDest) {
        // Die Ziele liegen in nav/*.kt. state/manDetailState werden nicht übergeben: Der
        // NavHost-Builder läuft nur einmal, ein durchgereichter Wert bliebe die
        // Momentaufnahme des ersten Frames. Die Ziele lesen den Zustand selbst per
        // collectAsStateWithLifecycle().
        authGraph(navController)
        collectionGraph(vm, navController, imageLoader, bottomNavItems, snackbarHostState,
            galleryGridState, partsGridState, minifigsGridState)
        catalogGraph(vm, katalog, navController, imageLoader, bottomNavItems, snackbarHostState)
        toolsGraph(vm, gutscheine, navController, imageLoader, bottomNavItems, snackbarHostState, activity,
            financeListState, partsListState, settingsScrollState)
    }
}
