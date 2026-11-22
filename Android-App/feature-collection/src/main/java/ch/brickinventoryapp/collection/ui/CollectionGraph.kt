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
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.collection.ui.screens.ComparisonScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryAndDetail
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryUndoRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedItemDetailRoute
import ch.brickinventoryapp.collection.ui.screens.WantedItemUndoRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListViewModel
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.navigation.AreaEnvironment
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.WithTarget
import ch.brickinventoryapp.ui.listAndDetail

/** What the collection needs from the app; the entry flow hangs on the destination that scans. */
interface CollectionNavigation : AreaEnvironment {
    /** The finance page holds the PDF viewer. */
    fun openPdf(url: String, title: String)

    /** All price alerts live in the settings (account area). */
    fun openPriceAlerts()
}

/** Gallery, set detail, purchases, watchlist, scanner and price comparison. */
fun NavGraphBuilder.collectionGraph(navigation: CollectionNavigation) {
    galleryTarget(navigation)
    setDetailTarget(navigation)
    wantedTargets(navigation)
    composable<CollectionTarget.AcquisitionManagement> { backStackEntry ->
        val target = backStackEntry.toRoute<CollectionTarget.AcquisitionManagement>()
        AcquisitionManagementRoute(
            vm      = hiltViewModel<PurchasesViewModel>(),
            type    = target.kind,
            id      = target.id,
            colorId = target.colorId,
            title   = target.title,
            onBack  = { navigation.navController.popBackStack() }
        )
    }
    scannerTarget(navigation)
    composable<CollectionTarget.Comparison> {
        navigation.Tab(stringResource(R.string.nav_comparison)) {
            ComparisonScreen()
        }
    }
}

/** The gallery; on wide windows the set detail sits next to it ([setDetailTarget]). */
private fun NavGraphBuilder.galleryTarget(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<CollectionTarget.Gallery> { entry ->
        val galleryVm: GalleryViewModel = hiltViewModel()
        // The gallery loads while observing its state (GalleryViewModel).
        val gallery by galleryVm.galleryState.collectAsStateWithLifecycle()
        val entryVm: EntryViewModel = hiltViewModel()
        EntryFrame(entry, entryVm, navigation.images) { navController.navigate(CollectionTarget.SetDetail(it)) }
        // One state per visit; only ScrollMemory holds the position.
        val galleryGridState = remember { LazyGridState() }
        ScrollPositionKeeper(
            CollectionTarget.Gallery.rollKey, galleryGridState, gallery.sets.isNotEmpty(), navigation.scrollMemory)
        // The set detail returns a deleted set as a result to this entry;
        // the gallery notes it with "Undo". No outside access to its ViewModel.
        val deleteTo by entry.savedStateHandle.getStateFlow<ArrayList<String>?>(DELETE_RESERVE, null)
            .collectAsStateWithLifecycle()
        LaunchedEffect(deleteTo) {
            val (sn, name) = deleteTo ?: return@LaunchedEffect
            galleryVm.markForDeletion(sn, name)
            entry.savedStateHandle[DELETE_RESERVE] = null
        }

        GalleryUndoRoute(galleryVm, navigation.snackbar)
        val target = this
        val scan = { navController.navigate(CollectionTarget.BarcodeScanner(ScannerOrigin.GALLERY_SEARCH)) }
        val open: (String) -> Unit = { navController.navigate(CollectionTarget.SetDetail(it)) }
        navigation.Tab(stringResource(R.string.nav_collection)) {
            WithTarget(target) {
            // On wide windows the space for the detail is already there before the first tap.
            BoxWithConstraints {
                if (listAndDetail(maxWidth.value)) {
                    GalleryAndDetail(galleryVm, entryVm, navigation.images, open = null, onSetClick = open,
                        onScanBarcode = scan, gridState = galleryGridState) {}
                } else {
                    GalleryRoute(vm = galleryVm, entryVm = entryVm, imageLoader = navigation.images,
                        onScanBarcode = scan, onSetClick = open, gridState = galleryGridState)
                }
            }
            }
        }
    }
}

/** Set detail; on wide windows with the gallery to the left of it. */
private fun NavGraphBuilder.setDetailTarget(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<CollectionTarget.SetDetail> { backStack ->
        val state by navigation.session.collectAsStateWithLifecycle()
        val setNumber = backStack.toRoute<CollectionTarget.SetDetail>().setNumber
        // If the gallery sits below (start destination), it accepts a deleted set as a result
        // and offers "Undo".
        val galleryEntry = remember(backStack) {
            runCatching { navController.getBackStackEntry<CollectionTarget.Gallery>() }.getOrNull()
        }
        val detailVm: SetDetailViewModel = hiltViewModel()
        // The tile from the cache shows the set right away, until the detail is there.
        val preview by detailVm.preview.collectAsStateWithLifecycle()
        val detail: @Composable () -> Unit = {
        SetDetailRoute(
            setNumber = setNumber,
            vm = detailVm,
            preview = preview,
            serverUrl = state.serverUrl,
            imageLoader = navigation.images,
            onBack = { navController.popBackStack() },
            // Back into the gallery, which marks the set with "Undo"; without
            // a gallery below (entry from outside) it's deleted right away.
            onDelete = { sn ->
                val name = detailVm.setDetailState.value.setDetail?.name ?: preview?.name ?: sn
                if (galleryEntry != null) galleryEntry.savedStateHandle[DELETE_RESERVE] = arrayListOf(sn, name)
                else detailVm.deleteSet(sn)
                navController.popBackStack()
            },
            undoPossible = galleryEntry != null,
            onNavigateToAcqMgmt = { type, id, colorId, title ->
                navController.navigate(CollectionTarget.AcquisitionManagement(type, id, colorId, title))
            },
            onOpenPdf = navigation::openPdf
        )
        }
        // On wide windows the gallery sits to the left of it (ReadingWidth.kt); a
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
    val gallery: GalleryViewModel = hiltViewModel(galleryEntry)
    val galleryUiState by gallery.galleryState.collectAsStateWithLifecycle()
    val gridState = remember { LazyGridState() }
    ScrollPositionKeeper(CollectionTarget.Gallery.rollKey, gridState, galleryUiState.sets.isNotEmpty(),
        navigation.scrollMemory)
    // The gallery's entry flow; the scanner hands the scan back to this destination.
    val entryVm: EntryViewModel = hiltViewModel(galleryEntry)
    EntryFrame(entry, entryVm, navigation.images) { navController.navigate(CollectionTarget.SetDetail(it)) }
    navigation.Tab(stringResource(R.string.nav_collection)) {
        GalleryAndDetail(
            gallery = gallery,
            entryVm = entryVm,
            imageLoader = navigation.images,
            open = setNumber,
            onScanBarcode = { navController.navigate(CollectionTarget.BarcodeScanner(ScannerOrigin.GALLERY_SEARCH)) },
            onSetClick = { sn ->
                if (sn != setNumber) navController.navigate(CollectionTarget.SetDetail(sn)) {
                    popUpTo<CollectionTarget.SetDetail> { inclusive = true }
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
    composable<CollectionTarget.Wanted> { entry ->
        val entryVm: EntryViewModel = hiltViewModel()
        EntryFrame(entry, entryVm, navigation.images) { navController.navigate(CollectionTarget.SetDetail(it)) }
        // List and detail side by side on wide windows (ReadingWidth.kt).
        BoxWithConstraints {
            val sideBySide = listAndDetail(maxWidth.value)
            navigation.Tab(stringResource(R.string.nav_wanted)) {
                val wantedList = hiltViewModel<WantedListViewModel>()
                WantedItemUndoRoute(wantedList, navigation.snackbar)
                WantedRoute(
                    vm = wantedList,
                    imageLoader = navigation.images,
                    sideBySide = sideBySide,
                    onScan = { navController.navigate(CollectionTarget.BarcodeScanner(ScannerOrigin.WANTED_LIST)) },
                    onOpenSingle = { sn, condition ->
                        navController.navigate(CollectionTarget.WantedItemDetail(sn, condition))
                    },
                    onOpenPriceAlerts = navigation::openPriceAlerts,
                )
            }
        }
    }
    composable<CollectionTarget.WantedItemDetail> { backStack ->
        val target = backStack.toRoute<CollectionTarget.WantedItemDetail>()
        // The same ViewModel as the list below: the snackbar with
        // "Undo" runs there after a deleted item's detail has returned.
        val list = remember(backStack) { runCatching { navController.getBackStackEntry<CollectionTarget.Wanted>() }.getOrNull() }
        WantedItemDetailRoute(
            vm = if (list != null) hiltViewModel<WantedListViewModel>(list) else hiltViewModel<WantedListViewModel>(),
            setNumber = target.setNumber,
            condition = target.condition,
            imageLoader = navigation.images,
            onBack = { navController.popBackStack() },
            onOpenPriceAlerts = navigation::openPriceAlerts,
        )
    }
}

/** The scanner; what a hit triggers is told by the origin in the route. */
private fun NavGraphBuilder.scannerTarget(navigation: CollectionNavigation) {
    val navController = navigation.navController
    composable<CollectionTarget.BarcodeScanner> { entry ->
        val origin = entry.toRoute<CollectionTarget.BarcodeScanner>().origin
        // The hit goes to the destination below; its entry flow resolves it.
        fun back(value: String, setNumber: Boolean) {
            navController.previousBackStackEntry?.savedStateHandle?.storeScan(value, setNumber, origin)
            navController.popBackStack()
        }
        BarcodeScannerScreen(
            // Text recognition only here: this scanner serves "Add set" (gallery) and
            // "Add to parts list". The price comparison has its own call and leaves
            // the default off.
            ocrEnabled = true,
            onResult = { scannedValue -> back(scannedValue, setNumber = false) },
            // Text recognition delivers the set number ready-made — the detour through
            // EAN resolution is unnecessary, saving up to eight Rebrickable calls per scan.
            onSetNumberResult = { setNumber -> back(setNumber, setNumber = true) },
            onDismiss = { navController.popBackStack() },
            typeInOn = {
                navController.previousBackStackEntry?.savedStateHandle?.storeTypeIn(origin)
                navController.popBackStack()
            },
        )
    }
}

/** Key of the delete result the set detail returns to the gallery: set number and name. */
private const val DELETE_RESERVE = "markForDeletion"
