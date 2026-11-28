package ch.brickinventoryapp.parts.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.navigation.AreaEnvironment
import ch.brickinventoryapp.parts.ui.dialogs.SetItemDetailArea
import ch.brickinventoryapp.parts.ui.dialogs.SetItemDetailDialog
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.WithSetItem
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.listAndDetail
import ch.brickinventoryapp.uistate.ScannerOrigin
import coil3.ImageLoader

/** What the scanner found for the parts list, along with the receipts. */
class PartListsScan(
    /** The scanned set number, until the parts list has taken it over. */
    val setNumber: String?,
    /** The scan came back without a number: the cursor should go into the set field. */
    val manualRecord: Boolean,
    val adopted: () -> Unit,
    val manualAcknowledged: () -> Unit,
)

/**
 * What parts and figures need from the app: the scan, which the collection resolves at
 * the [entry] destination, and the collection's destinations (set, purchases, scanner).
 */
interface PartsNavigation : AreaEnvironment {
    @Composable
    fun partListsScan(entry: NavBackStackEntry): PartListsScan

    fun openSet(setNumber: String)
    fun openPurchases(kind: ItemKind, id: String, colorId: Int, title: String)
    fun openScanner(origin: ScannerOrigin)
}

/** Parts, minifigures, their individual pages and the parts list. */
fun NavGraphBuilder.partsGraph(navigation: PartsNavigation) {
    partsTarget(navigation)
    minifigsTarget(navigation)
    singlePieceTarget(navigation)
    partListsTarget(navigation)
}

/** Parts: tab with a list and a detail next to it. The ViewModel loads the list and filter values when observed. */
private fun NavGraphBuilder.partsTarget(navigation: PartsNavigation) {
    composable<PartsTarget.Parts> {
        // One state per visit; only the ScrollMemory (Keeper below) holds the position.
        val partsGridState = remember { LazyGridState() }
        val partsVm: PartsViewModel = hiltViewModel()
        val state by partsVm.state.collectAsStateWithLifecycle()
        val partsState by partsVm.partsState.collectAsStateWithLifecycle()
        val partRoute = partsVm.delete.value.collectAsStateWithLifecycle().value
        UndoMessage(partRoute, stringResource(R.string.vm_set_deleted, partRoute?.name.orEmpty()), navigation.snackbar,
            partsVm.delete::undo, partsVm.delete::execute)
        navigation.Tab(stringResource(R.string.nav_parts)) {
            ScrollPositionKeeper(
                PartsTarget.Parts.rollKey, partsGridState,
                // `manualParts != null` means "the answer is back", even for manually
                // entered parts that are null; with `isNotEmpty()` an existing position would then never come back.
                ready = partsState.parts.isNotEmpty() && partsState.manualParts != null,
                memory = navigation.scrollMemory,
                topTrailing = partsState.manualParts?.size ?: 0)
            // The detail sits next to the list on the tablet, as a sheet or its
            // own page on the phone; here, because only the graph knows the NavController.
            PartsListAndDetailRoute(partsVm, navigation.images, state.serverUrl,
                navigation::openSinglePiece, navigation::openSet, navigation::openPurchases) { openManual ->
                PartsRoute(
                    vm = partsVm,
                    imageLoader = navigation.images,
                    onOpenDetail = { partNumber, colorId ->
                        openManual(ItemKind.PART, partNumber, colorId,
                            partsState.manualParts
                                ?.find { it.partNumber == partNumber && it.colorId == colorId }
                                ?.partName ?: partNumber)
                    },
                    gridState = partsGridState
                )
            }
        }
    }
}

/** Minifigures, like parts with a detail next to it. */
private fun NavGraphBuilder.minifigsTarget(navigation: PartsNavigation) {
    composable<PartsTarget.Minifigs> {
        val minifigsGridState = remember { LazyGridState() }
        val minifigsVm: MinifigsViewModel = hiltViewModel()
        val state by minifigsVm.sessionValues.collectAsStateWithLifecycle()
        val figures by minifigsVm.minifigsState.collectAsStateWithLifecycle()
        val minifigRoute = minifigsVm.delete.value.collectAsStateWithLifecycle().value
        UndoMessage(minifigRoute, stringResource(R.string.vm_set_deleted, minifigRoute?.name.orEmpty()), navigation.snackbar,
            minifigsVm.delete::undo, minifigsVm.delete::execute)
        navigation.Tab(stringResource(R.string.nav_minifigs)) {
            ScrollPositionKeeper(
                PartsTarget.Minifigs.rollKey, minifigsGridState,
                // Checked for completion, not content, as with the parts.
                ready = figures.minifigs.isNotEmpty() && figures.manualFigs != null,
                memory = navigation.scrollMemory,
                topTrailing = figures.manualFigs?.size ?: 0)
            ListAndDetailRoute(minifigsVm, navigation.images, state.serverUrl,
                navigation::openSinglePiece, navigation::openSet, navigation::openPurchases) { openManual ->
                MinifigsRoute(
                    vm = minifigsVm,
                    imageLoader = navigation.images,
                    onOpenDetail = { figNumber ->
                        openManual(ItemKind.FIG, figNumber, 0,
                            figures.manualFigs?.find { it.figNumber == figNumber }
                                ?.figName ?: figNumber)
                    },
                    gridState = minifigsGridState
                )
            }
        }
    }
}

private fun PartsNavigation.openSinglePiece(kind: ItemKind, id: String, color: Int, title: String) =
    navController.navigate(PartsTarget.ManualItemDetail(kind, id, color, title))

/** Detail page for manual parts and minifigures; built like the set detail. */
private fun NavGraphBuilder.singlePieceTarget(navigation: PartsNavigation) {
    val navController = navigation.navController
    composable<PartsTarget.ManualItemDetail> { backStackEntry ->
        val target = backStackEntry.toRoute<PartsTarget.ManualItemDetail>()
        // If the tab lies below, the detail deletes via its own ViewModel with „Rückgängig“;
        // this one's own would end with navigating back and take the pending item with it.
        val tab = remember(backStackEntry) {
            runCatching {
                if (target.kind == ItemKind.FIG) navController.getBackStackEntry<PartsTarget.Minifigs>()
                else navController.getBackStackEntry<PartsTarget.Parts>()
            }.getOrNull()
        }
        ManualItemDetailRoute(
            vm = hiltViewModel<PurchasesViewModel>(),
            parts = tab?.takeIf { target.kind != ItemKind.FIG }?.let { hiltViewModel<PartsViewModel>(it) } ?: hiltViewModel(),
            figures = tab?.takeIf { target.kind == ItemKind.FIG }?.let { hiltViewModel<MinifigsViewModel>(it) } ?: hiltViewModel(),
            undo = tab != null,
            item = target,
            imageLoader = navigation.images,
            onBack = { navController.popBackStack() },
            onNavigateToAcqMgmt = navigation::openPurchases,
            // The color is part of the route and the screen's search; after a change
            // it is reopened with the new color. Back first, then forward: otherwise
            // a back tap would land on exactly the color that was just being corrected.
            onColorChanged = { newColor ->
                navController.popBackStack()
                navController.navigate(target.copy(colorId = newColor))
            },
        )
    }
}

/** A set's parts list; the collection resolves the scan and passes the number in. */
private fun NavGraphBuilder.partListsTarget(navigation: PartsNavigation) {
    val navController = navigation.navController
    composable<PartsTarget.PartsList> { entry ->
        val state by navigation.session.collectAsStateWithLifecycle()
        val glance by navigation.viewport.collectAsStateWithLifecycle()
        val scan = navigation.partListsScan(entry)
        // The list lives in the destination's ViewModel and is already there when returning from the scanner.
        val partListsState = remember { LazyListState() }
        ScrollPositionKeeper(PART_LIST_SCROLL_KEY, partListsState, ready = true, memory = navigation.scrollMemory)
        navigation.Tab(stringResource(R.string.nav_partslist)) {
            PartsListRoute(
                serverUrl = state.serverUrl,
                imageLoader = navigation.images,
                onScanBarcode = { navigation.openScanner(ScannerOrigin.PART_LIST) },
                // An unsuccessful scan puts the cursor into the set field.
                requestManualEntry = scan.manualRecord,
                onManualEntryAcknowledged = scan.manualAcknowledged,
                // The same rule as in the web app (`sammlung.js`): more than
                // one member in the household means "there are sub-accounts".
                hasSubAccounts = glance.householdMembers.size > 1,
                barcodeSetNumber = scan.setNumber,
                onBarcodeConsumed = scan.adopted,
                listState = partListsState,
                snackbar = navigation.snackbar,
            )
        }
    }
}

/**
 * Parts and minifigures on wide windows: list on the left, detail on the right, as in the
 * wishlist. On the phone it stays at a sheet (part from sets) or its own
 * page (manually entered).
 */
@Composable
fun PartsListAndDetailRoute(
    partsVm: PartsViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    openSinglePiece: (ItemKind, String, Int, String) -> Unit,
    openSet: (String) -> Unit,
    openPurchases: (ItemKind, String, Int, String) -> Unit,
    list: @Composable (openManual: (ItemKind, String, Int, String) -> Unit) -> Unit,
) = ListAndDetailRoute(partsVm, imageLoader, serverUrl, openSinglePiece, openSet, openPurchases, list)

/** The same for parts and figures; the "which sets" detail comes from the tab's ViewModel. */
@Composable
internal fun ListAndDetailRoute(
    detailVm: WithSetItem,
    imageLoader: ImageLoader,
    serverUrl: String,
    openSinglePiece: (ItemKind, String, Int, String) -> Unit,
    openSet: (String) -> Unit,
    openPurchases: (ItemKind, String, Int, String) -> Unit,
    list: @Composable (openManual: (ItemKind, String, Int, String) -> Unit) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val sideBySide = listAndDetail(maxWidth.value)
        val setItem by detailVm.setItemState.collectAsStateWithLifecycle()
        val storage by detailVm.storageState.collectAsStateWithLifecycle()
        // Type, number, color, title of the open manual entry; a list because it can be saved.
        var manual by rememberSaveable { mutableStateOf<List<String>?>(null) }
        val openManual: (ItemKind, String, Int, String) -> Unit = { type, id, color, title ->
            if (sideBySide) {
                detailVm.closeSetItem()
                manual = listOf(type.identifier, id, color.toString(), title)
            } else openSinglePiece(type, id, color, title)
        }
        val open = manual
        if (sideBySide && (setItem.open || open != null)) {
            // The open part's tile is marked as in the wishlist and gallery.
            val openPart = setItem.kind?.let { kind ->
                detailKey(kind.identifier, setItem.number,
                    setItem.colorId.takeIf { kind == ItemKind.PART })
            }
            ListAndDetail(
                list = {
                    CompositionLocalProvider(LocalOpenDetail provides openPart) {
                        list(openManual)
                    }
                },
                detail = {
                    if (setItem.open) {
                        SetItemDetailArea(setItem, storage, detailVm, imageLoader, serverUrl, openSet)
                    } else if (open != null) key(open) {
                        ManualItemDetailRoute(
                            vm = hiltViewModel<PurchasesViewModel>(),
                            parts = detailVm as? PartsViewModel ?: hiltViewModel<PartsViewModel>(),
                            figures = detailVm as? MinifigsViewModel ?: hiltViewModel<MinifigsViewModel>(),
                            item = PartsTarget.ManualItemDetail(ItemKind.from(open[0]), open[1], open[2].toInt(), open[3]),
                            imageLoader = imageLoader,
                            onBack = { manual = null },
                            onNavigateToAcqMgmt = openPurchases,
                            onColorChanged = { newColor -> manual = listOf(open[0], open[1], newColor.toString(), open[3]) },
                            undo = (detailVm is MinifigsViewModel) == (open[0] == ItemKind.FIG.identifier),
                        )
                    }
                },
            )
        } else list(openManual)
        if (!sideBySide) SetItemDetailDialog(setItem, storage, detailVm, imageLoader, serverUrl, openSet)
    }
}

/** The parts list's key in the ScrollMemory; it is not a tab of the bottom bar. */
private const val PART_LIST_SCROLL_KEY = "partslist"
