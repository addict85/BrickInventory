package ch.brickinventoryapp

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.nav.authGraph
import ch.brickinventoryapp.nav.collectionGraph
import ch.brickinventoryapp.nav.catalogGraph
import ch.brickinventoryapp.nav.toolsGraph
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import coil3.ImageLoader
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.nav.Reiter
import ch.brickinventoryapp.nav.Rollzustaende
import ch.brickinventoryapp.nav.ZielUmgebung
import ch.brickinventoryapp.ui.components.UebergangsRahmen
import ch.brickinventoryapp.ui.dialogs.BarcodeResultRoute
import ch.brickinventoryapp.ui.dialogs.SetPruefungRoute
import ch.brickinventoryapp.ui.dialogs.UpdateRoute
import ch.brickinventoryapp.ui.viewmodel.CsvImportViewModel
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel

// Die Navigationsziele liegen seit der Aufteilung in nav/ (eigenes Paket).

/**
 * App-Navigation und Haupt-Gerüst: der NavHost mit allen Routen, die Dialoge, die
 * über jedem Bildschirm stehen, und das MainScaffold (TopBar/BottomBar). Im Paket
 * von MainActivity, damit sie sich ohne Import finden.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrickInventoryRoute(
    vm: AppViewModel,
    imageLoader: coil3.ImageLoader,
) {
    // collectAsStateWithLifecycle: Collection stoppt, wenn die App im
    // Hintergrund ist — kein unnötiges Recomposition-/State-Processing mehr.
    val state by vm.state.collectAsStateWithLifecycle()
    val erfassung: ErfassungViewModel = aktivitaetsViewModel()
    val barcodeState by erfassung.barcodeState.collectAsStateWithLifecycle()
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    val csvImport: CsvImportViewModel = aktivitaetsViewModel()
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    // Rollzustände oberhalb des NavHost (siehe Rollzustaende). Der Katalog merkt sich
    // seine Position im ViewModel, weil seine Plätze beim Zurückkommen noch nicht
    // geladen sind.
    val rollen = Rollzustaende(
        galerie = androidx.compose.foundation.lazy.grid.rememberLazyGridState(),
        teile = androidx.compose.foundation.lazy.grid.rememberLazyGridState(),
        minifiguren = androidx.compose.foundation.lazy.grid.rememberLazyGridState(),
        finanzen = androidx.compose.foundation.lazy.rememberLazyListState(),
        teileliste = androidx.compose.foundation.lazy.rememberLazyListState(),
        einstellungen = androidx.compose.foundation.rememberScrollState(),
    )

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
            csvImport.startCsvImportWatcher()
            // Beim Start still nach einem Update sehen: kein Ladebalken, keine Meldung
            // ohne Netz. Hier, weil die Frage der ganzen App gilt.
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

    val startDest = startRoute(startZiel(state.serverUrl, state.isLoggedIn, NetworkPolicy.entwicklung))
    val bottomNavItems = reiterDerLeiste()

    // ── Barcode-Bestätigung — über jedem Bildschirm ──
    // Der Dialog steht in ui/dialogs/BarcodeResultDialog.kt; hier nur, wann er erscheint.
    if (barcodeState.result != null) {
        BarcodeResultRoute(erfassung, imageLoader)
    }

    // ── „Wird geprüft“ — über allem, auch über dem Scanner-Weg ──
    // Hier, weil die Prüfung zu keinem einzelnen Bildschirm gehört: Sie beginnt im Scanner, der sich sofort schliesst, und läuft über Galerie, Teileliste oder Katalog weiter.
    SetPruefungRoute(erfassung)

    // ── „Es gibt eine neue Fassung“ — ebenfalls über allem ──
    //
    // Ein Hinweis beim Start mit Ja/Nein, weil ein Punkt in den Einstellungen leicht
    // übersehen wird. Hier, weil die Frage der ganzen App gilt; die auslösende Prüfung
    // steht ein paar Zeilen weiter oben.
    UpdateRoute(selbstUpdate)

    // Eine angetippte Preisalarm-Meldung öffnet ihr Set — hier, weil es den
    // NavController erst in dieser Composition gibt. Nur angemeldet; sonst bleibt
    // das Ziel stehen und wird nach der Anmeldung eingelöst.
    val meldungsZiel by vm.meldungsZiel.collectAsStateWithLifecycle()
    LaunchedEffect(meldungsZiel.setNummer, startDest) {
        val sn = meldungsZiel.setNummer
        if (sn != null && startDest == Screen.Gallery) {
            navController.navigate(Screen.SetDetail(sn))
            // Sofort quittieren, sonst springt die App bei der naechsten
            // Rekomposition erneut — dieselbe Regel wie bei der manuellen
            // Erfassung nach einem erfolglosen Scan.
            vm.setAusMeldungQuittieren()
        }
    }

    // Der gemeinsame Raum für Elementübergänge (Galerie → Set-Detail); das
    // vorhersagbare Zurück spielt denselben Übergang rückwärts.
    UebergangsRahmen {
    // Dezente Übergänge: kurz einblenden und ein Stück nachrücken, zurück in die
    // Gegenrichtung. Die Vorgabe (700 ms reines Überblenden) wirkte träge.
    NavHost(navController, startDestination = startDest,
        enterTransition = { fadeIn(tween(UEBERGANG_MS)) + slideInHorizontally(tween(UEBERGANG_MS)) { it / 16 } },
        exitTransition = { fadeOut(tween(UEBERGANG_MS / 2)) },
        popEnterTransition = { fadeIn(tween(UEBERGANG_MS)) },
        popExitTransition = { fadeOut(tween(UEBERGANG_MS / 2)) + slideOutHorizontally(tween(UEBERGANG_MS)) { it / 16 } },
    ) {
        // Kein Zustand hinein: Der NavHost-Builder läuft nur einmal, ein durchgereichter
        // Wert bliebe die Momentaufnahme des ersten Frames. Die Ziele lesen selbst.
        alleZiele(ZielUmgebung(navController, imageLoader, bottomNavItems,
            snackbarHostState, rollen))
    }
    }
}

/** Alle Ziele der App; der NavHost und ErreichbareRoutenTest bauen denselben Graphen. */
internal fun androidx.navigation.NavGraphBuilder.alleZiele(u: ZielUmgebung) {
    authGraph(u.navController)
    collectionGraph(u)
    catalogGraph(u)
    toolsGraph(u)
}

/** Wo die App beginnt, je nachdem, ob Server und Anmeldung schon da sind. */
internal fun startRoute(ziel: StartZiel): Screen = when (ziel) {
    StartZiel.EINRICHTUNG -> Screen.Setup
    StartZiel.ANMELDUNG   -> Screen.Login
    StartZiel.SAMMLUNG    -> Screen.Gallery
}

/**
 * Vier Bestandsziele und „Mehr“ — Material sieht höchstens fünf vor; der Rest steht
 * gruppiert auf „Mehr“. Symbole ohne Beschreibung: Die Beschriftung steht daneben,
 * sonst liest TalkBack doppelt. Merkliste vor dem Katalog, wie in der Webapp.
 */
@Composable
internal fun reiterDerLeiste(): List<Reiter> {
    val sammlung = stringResource(R.string.nav_collection)
    val finanzen = stringResource(R.string.nav_finance)
    val merkliste = stringResource(R.string.nav_wanted)
    val katalog = stringResource(R.string.nav_catalog)
    val mehr = stringResource(R.string.nav_more)
    return remember(sammlung, finanzen, merkliste, katalog, mehr) {
        listOf(
            Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, sammlung),
            Triple(Screen.Finance, { Icon(Icons.AutoMirrored.Filled.ShowChart, null) }, finanzen),
            Triple(Screen.Wanted, { Icon(Icons.Default.BookmarkBorder, null) }, merkliste),
            Triple(Screen.Catalog, { Icon(Icons.AutoMirrored.Filled.MenuBook, null) }, katalog),
            Triple(Screen.Mehr, { Icon(Icons.Default.MoreHoriz, null) }, mehr),
        )
    }
}

/** Dauer eines Seitenwechsels; kurz genug, dass er nicht aufhält. */
private const val UEBERGANG_MS = 220
