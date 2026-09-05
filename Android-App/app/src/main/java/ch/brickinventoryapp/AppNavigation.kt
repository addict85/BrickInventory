package ch.brickinventoryapp

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.*
import ch.brickinventoryapp.nav.authGraph
import ch.brickinventoryapp.nav.collectionGraph
import ch.brickinventoryapp.nav.catalogGraph
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.nav.toolsGraph
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import coil.ImageLoader
import ch.brickinventoryapp.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.res.stringResource

// Die Navigationsziele liegen seit der Aufteilung in nav/ (eigenes Paket).


/**
 * App-Navigation und Haupt-Gerüst — aus MainActivity.kt extrahiert.
 * Enthält den NavHost mit allen Routen, die Barcode-Dialoge und das
 * MainScaffold (TopBar/BottomBar). Gleiches Package wie MainActivity,
 * daher waren keine Referenz-Änderungen nötig.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrickInventoryManagerApp(
    vm: MainViewModel,
    // Der Katalog haelt seinen Zustand selbst; die Activity haelt beide, damit
    // Liste und Detail dieselbe Instanz sehen (siehe CatalogViewModel).
    katalog: CatalogViewModel,
    imageLoader: coil.ImageLoader,
) {
    // collectAsStateWithLifecycle: Collection stoppt, wenn die App im
    // Hintergrund ist — kein unnötiges Recomposition-/State-Processing mehr.
    val state by vm.state.collectAsStateWithLifecycle()
    val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    // ── Scroll-Zustände oberhalb des NavHost ────────────────────────────────
    //
    // Beim Öffnen einer Detailansicht wird das darunterliegende Ziel verworfen;
    // ein `rememberLazyListState()`/`rememberLazyGridState()` DARIN wäre bei der
    // Rückkehr zurückgesetzt, und die Liste spränge nach oben.
    //
    // Für die Finanz-Liste galt das schon; Galerie, Teile und Minifiguren
    // fehlten (Marcos Befund, Nachtrag 92) — alle drei führen genauso in eine
    // Detailansicht. Hier oben bleibt der Zustand am Leben, weil diese Ebene
    // beim Navigieren nicht verlassen wird.
    //
    // Der KATALOG ist bewusst nicht dabei: Seine Liste führt alle `total`
    // Plätze und lädt seitenweise nach, die Länge trifft also erst später ein.
    // Ein Zustand allein hilft dort nicht, weil im Moment der Rückkehr noch
    // keine Plätze da sind — er merkt sich die Position deshalb im ViewModel
    // und springt einmal zurück, sobald die Länge steht (CatalogScreen.kt).
    val financeListState   = androidx.compose.foundation.lazy.rememberLazyListState()
    val galleryGridState   = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val partsGridState     = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val minifigsGridState  = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val partsListState     = androidx.compose.foundation.lazy.rememberLazyListState()

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
            // ── Still nach einem Update sehen ───────────────────────────────
            //
            // Marcos Vorgabe: beim Start PRUEFEN, aber nie von allein laden.
            // Genau das tut `still = true` — ein kleiner HTTPS-Abruf ohne
            // Ladebalken, und im Fehlerfall ohne Meldung. Wer ohne Netz
            // startet, soll keine rote Zeile sehen; wer den Knopf in den
            // Einstellungen drueckt, sehr wohl (ui/UpdateFeature.kt).
            //
            // Hier und nicht im Einstellungs-Bildschirm: Die Frage „gibt es
            // etwas Neueres?" gilt der ganzen App. Im Bildschirm gestellt,
            // bekaeme sie nur, wer ohnehin schon in den Einstellungen sitzt.
            vm.pruefeAufUpdate(still = true)
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
    val labelGallery    = stringResource(R.string.nav_gallery)
    val labelCatalog    = stringResource(R.string.nav_catalog)
    val labelParts      = stringResource(R.string.nav_parts)
    val labelMinifigs   = stringResource(R.string.nav_minifigs_short)
    val labelPartslist  = stringResource(R.string.nav_partslist)
    val labelFinance    = stringResource(R.string.nav_finance)
    val labelComparison = stringResource(R.string.nav_comparison)

    val bottomNavItems = remember(labelGallery, labelCatalog, labelParts, labelMinifigs, labelPartslist, labelFinance, labelComparison) {
        buildList<Triple<Screen, @Composable () -> Unit, String>> {
            add(Triple(Screen.Gallery,    { Icon(ImageVector.vectorResource(R.drawable.ic_brand_brick), labelGallery, tint = Color.Unspecified) },    labelGallery))
            add(Triple(Screen.Parts,      { Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), labelParts, tint = Color.Unspecified) },     labelParts))
            add(Triple(Screen.Minifigs,   { Text("👷", fontSize = 20.sp) },        labelMinifigs))
            add(Triple(Screen.PartsList,  { Text("📋", fontSize = 20.sp) },        labelPartslist))
            add(Triple(Screen.Finance,    { Text("💰", fontSize = 20.sp) },        labelFinance))
            add(Triple(Screen.Catalog,    { Text("📚", fontSize = 20.sp) },        labelCatalog))
            add(Triple(Screen.Comparison, { Icon(ImageVector.vectorResource(R.drawable.ic_compare_scale), labelComparison, tint = Color.Unspecified) }, labelComparison))
        }
    }

    // ── Barcode confirmation dialog — shown over any screen ──────────────────
    // Der Barcode-Dialog steht seit Nachtrag 97 in
    // ui/dialogs/BarcodeResultDialog.kt — er machte zwei Drittel dieser
    // Funktion aus, die eigentlich den NavHost aufbaut.
    if (barcodeState.result != null) {
        ch.brickinventoryapp.ui.dialogs.BarcodeResultDialog(vm, imageLoader)
    }

    // ── „Wird geprüft" — über allem, auch über dem Scanner-Weg ──────────────
    // Neben dem Bestätigungsdialog und aus demselben Grund hier: Die Prüfung
    // gehört zu keinem einzelnen Bildschirm. Sie beginnt im Scanner, der sich
    // sofort schliesst, und läuft danach über Galerie, Teileliste oder Katalog
    // weiter — je nachdem, wo man gerade steht.
    ch.brickinventoryapp.ui.dialogs.SetPruefungDialog(vm)


    val activity = androidx.compose.ui.platform.LocalContext.current
    NavHost(navController, startDestination = startDest) {
        // Ziele liegen in nav/*.kt — siehe Punkt 9 im CHANGELOG.
        // state/manDetailState werden NICHT übergeben: Der NavHost-Builder läuft
        // nur einmal, ein durchgereichter Wert wäre für immer die Momentaufnahme
        // vom ersten Frame. Die Ziele lesen den Zustand selbst per
        // collectAsStateWithLifecycle() — so wie es der Katalog schon immer tat.
        authGraph(vm, navController)
        collectionGraph(vm, navController, imageLoader, bottomNavItems, snackbarHostState,
            galleryGridState, partsGridState, minifigsGridState)
        catalogGraph(vm, katalog, navController, imageLoader, bottomNavItems, snackbarHostState)
        toolsGraph(vm, navController, imageLoader, bottomNavItems, snackbarHostState, activity,
            financeListState, partsListState)
    }
}
