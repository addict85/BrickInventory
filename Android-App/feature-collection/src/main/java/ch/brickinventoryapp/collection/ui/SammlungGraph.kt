package ch.brickinventoryapp.collection.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.collection.ui.screens.ComparisonScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryUndoRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryAndDetail
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.screens.WantedItemDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedItemUndoRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.WithTarget
import ch.brickinventoryapp.ui.listAndDetail
import ch.brickinventoryapp.navigation.Bereichsumgebung
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel

/** What the collection needs from the app; the entry flow hangs on the destination that scans. */
interface CollectionNavigation : Bereichsumgebung {
    /** The finance page holds the PDF viewer. */
    fun openPdf(url: String, titel: String)

    /** All price alerts live in the settings (account area). */
    fun openPriceAlerts()
}

/** Gallery, set detail, purchases, watchlist, scanner and price comparison. */
fun NavGraphBuilder.collectionGraph(navigation: CollectionNavigation) {
    galleryTarget(navigation)
    setDetailTarget(navigation)
    wantedTargets(navigation)
    composable<SammlungZiel.AcquisitionManagement> { backStackEntry ->
        val ziel = backStackEntry.toRoute<SammlungZiel.AcquisitionManagement>()
        AcquisitionManagementRoute(
            vm      = hiltViewModel<KaeufeViewModel>(),
            type    = ziel.art,
            id      = ziel.id,
            colorId = ziel.colorId,
            title   = ziel.title,
            onBack  = { navigation.navController.popBackStack() }
        )
    }
    scannerTarget(navigation)
    composable<SammlungZiel.Comparison> {
        navigation.Reiter(stringResource(R.string.nav_comparison)) {
            ComparisonScreen()
        }
    }
}

/** The gallery; on wide windows the set detail sits next to it ([setDetailTarget]). */
private fun NavGraphBuilder.galleryTarget(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<SammlungZiel.Gallery> { entry ->
        val galleryVm: GalleryViewModel = hiltViewModel()
        // The gallery loads while observing its state (GalleryViewModel).
        val galerie by galleryVm.galleryState.collectAsStateWithLifecycle()
        val erfassung: EntryViewModel = hiltViewModel()
        Erfassungsrahmen(entry, erfassung, navigation.bilder) { navController.navigate(SammlungZiel.SetDetail(it)) }
        // One state per visit; only ScrollMemory holds the position.
        val galleryGridState = remember { LazyGridState() }
        ScrollPositionKeeper(
            SammlungZiel.Gallery.rollSchluessel, galleryGridState, galerie.sets.isNotEmpty(), navigation.rollgedaechtnis)
        // The set detail returns a deleted set as a result to this entry;
        // the gallery notes it with "Undo". No outside access to its ViewModel.
        val deleteTo by entry.savedStateHandle.getStateFlow<ArrayList<String>?>(DELETE_RESERVE, null)
            .collectAsStateWithLifecycle()
        LaunchedEffect(deleteTo) {
            val (sn, name) = deleteTo ?: return@LaunchedEffect
            galleryVm.loeschenVormerken(sn, name)
            entry.savedStateHandle[DELETE_RESERVE] = null
        }

        GalleryUndoRoute(galleryVm, navigation.snackbar)
        val ziel = this
        val scannen = { navController.navigate(SammlungZiel.BarcodeScanner(Scannerherkunft.GALERIE_SUCHE)) }
        val oeffnen: (String) -> Unit = { navController.navigate(SammlungZiel.SetDetail(it)) }
        navigation.Reiter(stringResource(R.string.nav_collection)) {
            WithTarget(ziel) {
            // On wide windows the space for the detail is already there before the first tap.
            BoxWithConstraints {
                if (listAndDetail(maxWidth.value)) {
                    GalleryAndDetail(galleryVm, erfassung, navigation.bilder, offen = null, onSetClick = oeffnen,
                        onScanBarcode = scannen, gridState = galleryGridState) {}
                } else {
                    GalleryRoute(vm = galleryVm, erfassung = erfassung, imageLoader = navigation.bilder,
                        onScanBarcode = scannen, onSetClick = oeffnen, gridState = galleryGridState)
                }
            }
            }
        }
    }
}

/** Set detail; on wide windows with the gallery to the left of it. */
private fun NavGraphBuilder.setDetailTarget(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<SammlungZiel.SetDetail> { backStack ->
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val setNumber = backStack.toRoute<SammlungZiel.SetDetail>().setNumber
        // If the gallery sits below (start destination), it accepts a deleted set as a result
        // and offers "Undo".
        val galleryEntry = remember(backStack) {
            runCatching { navController.getBackStackEntry<SammlungZiel.Gallery>() }.getOrNull()
        }
        val detailVm: SetDetailViewModel = hiltViewModel()
        // The tile from the cache shows the set right away, until the detail is there.
        val vorschau by detailVm.vorschau.collectAsStateWithLifecycle()
        val detail: @Composable () -> Unit = {
        SetDetailRoute(
            setNumber = setNumber,
            vm = detailVm,
            vorschau = vorschau,
            serverUrl = state.serverUrl,
            imageLoader = navigation.bilder,
            onBack = { navController.popBackStack() },
            // Back into the gallery, which marks the set with "Undo"; without
            // a gallery below (entry from outside) it's deleted right away.
            onDelete = { sn ->
                val name = detailVm.setDetailState.value.setDetail?.name ?: vorschau?.name ?: sn
                if (galleryEntry != null) galleryEntry.savedStateHandle[DELETE_RESERVE] = arrayListOf(sn, name)
                else detailVm.deleteSet(sn)
                navController.popBackStack()
            },
            rueckgaengigMoeglich = galleryEntry != null,
            onNavigateToAcqMgmt = { type, id, colorId, title ->
                navController.navigate(SammlungZiel.AcquisitionManagement(type, id, colorId, title))
            },
            onOpenPdf = navigation::openPdf
        )
        }
        // On wide windows the gallery sits to the left of it (Lesebreite.kt); a
        // different set replaces this detail instead of stacking over it. Without
        // a shared image: tile and detail are then both visible.
        BoxWithConstraints {
            if (galleryEntry != null && listAndDetail(maxWidth.value))
                GalleryBesideDetailRoute(navigation, backStack, galleryEntry, setNumber, detail)
            else WithTarget(this@composable) { detail() }
        }
    }
}

/** The gallery to the left of the set detail; a different set replaces the detail instead of stacking. */
@Composable
private fun GalleryBesideDetailRoute(
    navigation: CollectionNavigation,
    entry: NavBackStackEntry,
    galleryEntry: NavBackStackEntry,
    setNumber: String,
    detail: @Composable () -> Unit,
) {
    val navController = navigation.navController
    // The list on the left is the gallery itself, hence its ViewModel; the scroll position is
    // shared with the gallery destination via ScrollMemory.
    val galerie: GalleryViewModel = hiltViewModel(galleryEntry)
    val galerieZustand by galerie.galleryState.collectAsStateWithLifecycle()
    val gridState = remember { LazyGridState() }
    ScrollPositionKeeper(SammlungZiel.Gallery.rollSchluessel, gridState, galerieZustand.sets.isNotEmpty(),
        navigation.rollgedaechtnis)
    // The gallery's entry flow; the scanner hands the scan back to this destination.
    val erfassung: EntryViewModel = hiltViewModel(galleryEntry)
    Erfassungsrahmen(entry, erfassung, navigation.bilder) { navController.navigate(SammlungZiel.SetDetail(it)) }
    navigation.Reiter(stringResource(R.string.nav_collection)) {
        GalleryAndDetail(
            galerie = galerie,
            erfassung = erfassung,
            imageLoader = navigation.bilder,
            offen = setNumber,
            onScanBarcode = { navController.navigate(SammlungZiel.BarcodeScanner(Scannerherkunft.GALERIE_SUCHE)) },
            onSetClick = { sn ->
                if (sn != setNumber) navController.navigate(SammlungZiel.SetDetail(sn)) {
                    popUpTo<SammlungZiel.SetDetail> { inclusive = true }
                }
            },
            gridState = gridState,
            detail = detail,
        )
    }
}

/**
 * The watchlist lives in the collection: a watchlist item is a set one doesn't
 * have yet. The most common way in comes from the catalog.
 */
private fun NavGraphBuilder.wantedTargets(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<SammlungZiel.Wanted> { entry ->
        val erfassung: EntryViewModel = hiltViewModel()
        Erfassungsrahmen(entry, erfassung, navigation.bilder) { navController.navigate(SammlungZiel.SetDetail(it)) }
        // List and detail side by side on wide windows (Lesebreite.kt).
        BoxWithConstraints {
            val sideBySide = listAndDetail(maxWidth.value)
            navigation.Reiter(stringResource(R.string.nav_wanted)) {
                val merkliste = hiltViewModel<MerklisteViewModel>()
                WantedItemUndoRoute(merkliste, navigation.snackbar)
                WantedRoute(
                    vm = merkliste,
                    imageLoader = navigation.bilder,
                    sideBySide = sideBySide,
                    onScan = { navController.navigate(SammlungZiel.BarcodeScanner(Scannerherkunft.MERKLISTE)) },
                    onOpenSingle = { sn, zustand ->
                        navController.navigate(SammlungZiel.MerkpostenDetail(sn, zustand))
                    },
                    onOpenPriceAlerts = navigation::openPriceAlerts,
                )
            }
        }
    }
    composable<SammlungZiel.MerkpostenDetail> { backStack ->
        val ziel = backStack.toRoute<SammlungZiel.MerkpostenDetail>()
        // The same ViewModel as the list below: the snackbar with
        // "Undo" runs there after a deleted item's detail has returned.
        val liste = remember(backStack) { runCatching { navController.getBackStackEntry<SammlungZiel.Wanted>() }.getOrNull() }
        WantedItemDetailRoute(
            vm = if (liste != null) hiltViewModel<MerklisteViewModel>(liste) else hiltViewModel<MerklisteViewModel>(),
            setNumber = ziel.setNumber,
            condition = ziel.condition,
            imageLoader = navigation.bilder,
            onBack = { navController.popBackStack() },
            onOpenPriceAlerts = navigation::openPriceAlerts,
        )
    }
}

/** The scanner; what a hit triggers is told by the origin in the route. */
private fun NavGraphBuilder.scannerTarget(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<SammlungZiel.BarcodeScanner> { entry ->
        val herkunft = entry.toRoute<SammlungZiel.BarcodeScanner>().herkunft
        // The hit goes to the destination below; its entry flow resolves it.
        fun zurueck(wert: String, setnummer: Boolean) {
            navController.previousBackStackEntry?.savedStateHandle?.putScanAb(wert, setnummer, herkunft)
            navController.popBackStack()
        }
        BarcodeScannerScreen(
            // Text recognition only here: this scanner serves "Add set" (gallery) and
            // "Add to parts list". The price comparison has its own call and leaves
            // the default off.
            ocrEnabled = true,
            onResult = { scannedValue -> zurueck(scannedValue, setnummer = false) },
            // Text recognition delivers the set number ready-made — the detour through
            // EAN resolution is unnecessary, saving up to eight Rebrickable calls per scan.
            onSetNumberResult = { setNumber -> zurueck(setNumber, setnummer = true) },
            onDismiss = { navController.popBackStack() },
            typeInOn = {
                navController.previousBackStackEntry?.savedStateHandle?.putTypeInAb(herkunft)
                navController.popBackStack()
            },
        )
    }
}

/** Key of the delete result the set detail returns to the gallery: set number and name. */
private const val DELETE_RESERVE = "loeschenVormerken"
