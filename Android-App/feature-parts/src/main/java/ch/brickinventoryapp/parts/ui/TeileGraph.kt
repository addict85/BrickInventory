package ch.brickinventoryapp.parts.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.layout.fillMaxSize
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
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.dialogs.SetItemDetailArea
import ch.brickinventoryapp.parts.ui.dialogs.SetItemDetailDialog
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.WithSetItem
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.listAndDetail
import ch.brickinventoryapp.navigation.Bereichsumgebung
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel
import coil3.ImageLoader

/** What the scanner found for the parts list, along with the receipts. */
class PartListsScan(
    /** The scanned set number, until the parts list has taken it over. */
    val setNumber: String?,
    /** The scan came back without a number: the cursor should go into the set field. */
    val manuellErfassen: Boolean,
    val uebernommen: () -> Unit,
    val manualAcknowledged: () -> Unit,
)

/**
 * What parts and figures need from the app: the scan, which the collection resolves at
 * the [entry] destination, and the collection's destinations (set, purchases, scanner).
 */
interface PartsNavigation : Bereichsumgebung {
    @Composable
    fun partListsScan(entry: NavBackStackEntry): PartListsScan

    fun openSet(setNumber: String)
    fun openPurchases(art: Postenart, id: String, colorId: Int, titel: String)
    fun openScanner(herkunft: Scannerherkunft)
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
    composable<TeileZiel.Parts> {
        // One state per visit; only the ScrollMemory (Keeper below) holds the position.
        val partsGridState = remember { LazyGridState() }
        val partsVm: PartsViewModel = hiltViewModel()
        val state by partsVm.state.collectAsStateWithLifecycle()
        val partsState by partsVm.teileState.collectAsStateWithLifecycle()
        val partRoute = partsVm.loeschen.wert.collectAsStateWithLifecycle().value
        UndoMessage(partRoute, stringResource(R.string.vm_set_deleted, partRoute?.name.orEmpty()), navigation.snackbar,
            partsVm.loeschen::rueckgaengig, partsVm.loeschen::ausfuehren)
        navigation.Reiter(stringResource(R.string.nav_parts)) {
            ScrollPositionKeeper(
                TeileZiel.Parts.rollSchluessel, partsGridState,
                // `manualParts != null` means "the answer is back", even for manually
                // entered parts that are null; with `isNotEmpty()` an existing position would then never come back.
                bereit = partsState.parts.isNotEmpty() && partsState.manualParts != null,
                speicher = navigation.rollgedaechtnis,
                obenNachziehend = partsState.manualParts?.size ?: 0)
            // The detail sits next to the list on the tablet, as a sheet or its
            // own page on the phone; here, because only the graph knows the NavController.
            PartsListAndDetailRoute(partsVm, navigation.bilder, state.serverUrl,
                navigation::openSinglePiece, navigation::openSet, navigation::openPurchases) { openManual ->
                PartsRoute(
                    vm = partsVm,
                    imageLoader = navigation.bilder,
                    onOpenDetail = { partNumber, colorId ->
                        openManual(Postenart.PART, partNumber, colorId,
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
    composable<TeileZiel.Minifigs> {
        val minifigsGridState = remember { LazyGridState() }
        val minifigsVm: MinifigsViewModel = hiltViewModel()
        val state by minifigsVm.sessionValues.collectAsStateWithLifecycle()
        val figuren by minifigsVm.minifigsState.collectAsStateWithLifecycle()
        val minifigRoute = minifigsVm.loeschen.wert.collectAsStateWithLifecycle().value
        UndoMessage(minifigRoute, stringResource(R.string.vm_set_deleted, minifigRoute?.name.orEmpty()), navigation.snackbar,
            minifigsVm.loeschen::rueckgaengig, minifigsVm.loeschen::ausfuehren)
        navigation.Reiter(stringResource(R.string.nav_minifigs)) {
            ScrollPositionKeeper(
                TeileZiel.Minifigs.rollSchluessel, minifigsGridState,
                // Checked for completion, not content, as with the parts.
                bereit = figuren.minifigs.isNotEmpty() && figuren.manualFigs != null,
                speicher = navigation.rollgedaechtnis,
                obenNachziehend = figuren.manualFigs?.size ?: 0)
            ListAndDetailRoute(minifigsVm, navigation.bilder, state.serverUrl,
                navigation::openSinglePiece, navigation::openSet, navigation::openPurchases) { openManual ->
                MinifigsRoute(
                    vm = minifigsVm,
                    imageLoader = navigation.bilder,
                    onOpenDetail = { figNumber ->
                        openManual(Postenart.FIG, figNumber, 0,
                            figuren.manualFigs?.find { it.figNumber == figNumber }
                                ?.figName ?: figNumber)
                    },
                    gridState = minifigsGridState
                )
            }
        }
    }
}

private fun PartsNavigation.openSinglePiece(art: Postenart, id: String, farbe: Int, titel: String) =
    navController.navigate(TeileZiel.ManualItemDetail(art, id, farbe, titel))

/** Detail page for manual parts and minifigures; built like the set detail. */
private fun NavGraphBuilder.singlePieceTarget(navigation: PartsNavigation) {
    val navController = navigation.navController
    composable<TeileZiel.ManualItemDetail> { backStackEntry ->
        val ziel = backStackEntry.toRoute<TeileZiel.ManualItemDetail>()
        // If the tab lies below, the detail deletes via its own ViewModel with „Rückgängig“;
        // this one's own would end with navigating back and take the pending item with it.
        val tab = remember(backStackEntry) {
            runCatching {
                if (ziel.art == Postenart.FIG) navController.getBackStackEntry<TeileZiel.Minifigs>()
                else navController.getBackStackEntry<TeileZiel.Parts>()
            }.getOrNull()
        }
        ManualItemDetailRoute(
            vm = hiltViewModel<KaeufeViewModel>(),
            teile = tab?.takeIf { ziel.art != Postenart.FIG }?.let { hiltViewModel<PartsViewModel>(it) } ?: hiltViewModel(),
            figuren = tab?.takeIf { ziel.art == Postenart.FIG }?.let { hiltViewModel<MinifigsViewModel>(it) } ?: hiltViewModel(),
            rueckgaengig = tab != null,
            type = ziel.art,
            id = ziel.id,
            colorId = ziel.colorId,
            fallbackTitle = ziel.title,
            imageLoader = navigation.bilder,
            onBack = { navController.popBackStack() },
            onNavigateToAcqMgmt = navigation::openPurchases,
            // The color is part of the route and the screen's search; after a change
            // it is reopened with the new color. Back first, then forward: otherwise
            // a back tap would land on exactly the color that was just being corrected.
            onFarbeGeaendert = { neueFarbe ->
                navController.popBackStack()
                navController.navigate(ziel.copy(colorId = neueFarbe))
            },
        )
    }
}

/** A set's parts list; the collection resolves the scan and passes the number in. */
private fun NavGraphBuilder.partListsTarget(navigation: PartsNavigation) {
    val navController = navigation.navController
    composable<TeileZiel.PartsList> { entry ->
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val blick by navigation.blickfeld.collectAsStateWithLifecycle()
        val scan = navigation.partListsScan(entry)
        // The list lives in the destination's ViewModel and is already there when returning from the scanner.
        val teilelistenState = remember { LazyListState() }
        ScrollPositionKeeper(TEILELISTE_ROLLSCHLUESSEL, teilelistenState, bereit = true, speicher = navigation.rollgedaechtnis)
        navigation.Reiter(stringResource(R.string.nav_partslist)) {
            PartsListRoute(
                serverUrl = state.serverUrl,
                imageLoader = navigation.bilder,
                onScanBarcode = { navigation.openScanner(Scannerherkunft.TEILELISTE) },
                // Erfolgloser Scan → Cursor ins Set-Feld.
                manuelleErfassungAnfordern = scan.manuellErfassen,
                onManuelleErfassungQuittiert = scan.manualAcknowledged,
                // The same rule as in the web app (sammlung.js): more than
                // one member in the household means "there are sub-accounts".
                hatUnterkonten = blick.householdMembers.size > 1,
                barcodeSetNumber = scan.setNumber,
                onBarcodeConsumed = scan.uebernommen,
                listState = teilelistenState,
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
    openSinglePiece: (Postenart, String, Int, String) -> Unit,
    openSet: (String) -> Unit,
    openPurchases: (Postenart, String, Int, String) -> Unit,
    liste: @Composable (openManual: (Postenart, String, Int, String) -> Unit) -> Unit,
) = ListAndDetailRoute(partsVm, imageLoader, serverUrl, openSinglePiece, openSet, openPurchases, liste)

/** The same for parts and figures; the "which sets" detail comes from the tab's ViewModel. */
@Composable
internal fun ListAndDetailRoute(
    detailVm: WithSetItem,
    imageLoader: ImageLoader,
    serverUrl: String,
    openSinglePiece: (Postenart, String, Int, String) -> Unit,
    openSet: (String) -> Unit,
    openPurchases: (Postenart, String, Int, String) -> Unit,
    liste: @Composable (openManual: (Postenart, String, Int, String) -> Unit) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val sideBySide = listAndDetail(maxWidth.value)
        val setItem by detailVm.setItemState.collectAsStateWithLifecycle()
        val lager by detailVm.storageState.collectAsStateWithLifecycle()
        // Type, number, color, title of the open manual entry; a list because it can be saved.
        var manuell by rememberSaveable { mutableStateOf<List<String>?>(null) }
        val openManual: (Postenart, String, Int, String) -> Unit = { typ, id, farbe, titel ->
            if (sideBySide) {
                detailVm.closeSetItem()
                manuell = listOf(typ.kennung, id, farbe.toString(), titel)
            } else openSinglePiece(typ, id, farbe, titel)
        }
        val offen = manuell
        if (sideBySide && (setItem.offen || offen != null)) {
            // The open part's tile is marked as in the wishlist and gallery.
            val openPart = setItem.art?.let { art ->
                detailKey(art.kennung, setItem.nummer,
                    setItem.colorId.takeIf { art == Postenart.PART })
            }
            ListAndDetail(
                liste = {
                    CompositionLocalProvider(LocalOpenDetail provides openPart) {
                        liste(openManual)
                    }
                },
                detail = {
                    if (setItem.offen) {
                        SetItemDetailArea(setItem, lager, detailVm, imageLoader, serverUrl, openSet)
                    } else if (offen != null) key(offen) {
                        ManualItemDetailRoute(
                            vm = hiltViewModel<KaeufeViewModel>(),
                            teile = detailVm as? PartsViewModel ?: hiltViewModel<PartsViewModel>(),
                            figuren = detailVm as? MinifigsViewModel ?: hiltViewModel<MinifigsViewModel>(),
                            type = Postenart.aus(offen[0]),
                            id = offen[1],
                            colorId = offen[2].toInt(),
                            fallbackTitle = offen[3],
                            imageLoader = imageLoader,
                            onBack = { manuell = null },
                            onNavigateToAcqMgmt = openPurchases,
                            onFarbeGeaendert = { neueFarbe -> manuell = listOf(offen[0], offen[1], neueFarbe.toString(), offen[3]) },
                            rueckgaengig = (detailVm is MinifigsViewModel) == (offen[0] == Postenart.FIG.kennung),
                        )
                    }
                },
            )
        } else liste(openManual)
        if (!sideBySide) SetItemDetailDialog(setItem, lager, detailVm, imageLoader, serverUrl, openSet)
    }
}

/** The parts list's key in the ScrollMemory; it is not a tab of the bottom bar. */
private const val TEILELISTE_ROLLSCHLUESSEL = "partslist"
