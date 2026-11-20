package ch.brickinventoryapp.teile.ui

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
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.teile.ui.dialogs.SetItemDetailArea
import ch.brickinventoryapp.teile.ui.dialogs.SetItemDetailDialog
import ch.brickinventoryapp.teile.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.teile.ui.screens.MinifigsRoute
import ch.brickinventoryapp.teile.ui.screens.PartsListRoute
import ch.brickinventoryapp.teile.ui.screens.PartsRoute
import ch.brickinventoryapp.teile.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.WithSetItem
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.detailKey
import ch.brickinventoryapp.ui.listAndDetail
import ch.brickinventoryapp.navigation.Bereichsumgebung
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import coil3.ImageLoader

/** Was der Scanner für die Teileliste gefunden hat, samt den Quittungen. */
class PartListsScan(
    /** Die gescannte Setnummer, bis die Teileliste sie übernommen hat. */
    val setNumber: String?,
    /** Der Scan blieb ohne Nummer: Der Cursor soll ins Set-Feld. */
    val manuellErfassen: Boolean,
    val uebernommen: () -> Unit,
    val manualAcknowledged: () -> Unit,
)

/**
 * Was Teile und Figuren von der App brauchen: den Scan, den die Sammlung am Ziel
 * [entry] auflöst, und die Ziele der Sammlung (Set, Käufe, Scanner).
 */
interface PartsNavigation : Bereichsumgebung {
    @Composable
    fun partListsScan(entry: NavBackStackEntry): PartListsScan

    fun openSet(setNumber: String)
    fun openPurchases(art: Postenart, id: String, colorId: Int, titel: String)
    fun openScanner(herkunft: Scannerherkunft)
}

/** Teile, Minifiguren, ihre Einzelseiten und die Teileliste. */
fun NavGraphBuilder.partsGraph(navigation: PartsNavigation) {
    partsTarget(navigation)
    minifigsTarget(navigation)
    singlePieceTarget(navigation)
    partListsTarget(navigation)
}

/** Teile: Reiter mit Liste und Detail daneben. Liste und Filterwerte lädt das ViewModel beim Beobachten. */
private fun NavGraphBuilder.partsTarget(navigation: PartsNavigation) {
    composable<TeileZiel.Parts> {
        // Ein Zustand je Besuch; die Stelle hält allein der ScrollMemory (Keeper unten).
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
                // `manualParts != null` heisst „die Antwort ist zurück“, auch bei null manuell
                // erfassten Teilen; mit `isNotEmpty()` käme die Position dann nie wieder.
                bereit = partsState.parts.isNotEmpty() && partsState.manualParts != null,
                speicher = navigation.rollgedaechtnis,
                obenNachziehend = partsState.manualParts?.size ?: 0)
            // Das Detail steht auf dem Tablet neben der Liste, auf dem Telefon als Blatt bzw.
            // eigene Seite; hier, weil nur der Graph den NavController kennt.
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

/** Minifiguren, wie die Teile mit Detail daneben. */
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
                // Auf abgeschlossen statt auf Inhalt prüfen, wie bei den Teilen.
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

/** Detailseite manueller Teile und Minifiguren; Aufbau wie beim Set-Detail. */
private fun NavGraphBuilder.singlePieceTarget(navigation: PartsNavigation) {
    val navController = navigation.navController
    composable<TeileZiel.ManualItemDetail> { backStackEntry ->
        val ziel = backStackEntry.toRoute<TeileZiel.ManualItemDetail>()
        // Liegt der Reiter darunter, löscht das Detail über dessen ViewModel mit „Rückgängig“;
        // das eigene endete mit dem Zurückgehen und nähme das Vorgemerkte mit.
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
            // Die Farbe ist Teil der Route und der Suche im Screen; nach einer Änderung
            // wird er mit der neuen Farbe neu geöffnet. Erst zurück, dann hin: Sonst
            // landete ein Zurück-Tipp auf genau der Farbe, die gerade korrigiert wurde.
            onFarbeGeaendert = { neueFarbe ->
                navController.popBackStack()
                navController.navigate(ziel.copy(colorId = neueFarbe))
            },
        )
    }
}

/** Die Teileliste eines Sets; den Scan löst die Sammlung auf und reicht die Nummer herein. */
private fun NavGraphBuilder.partListsTarget(navigation: PartsNavigation) {
    val navController = navigation.navController
    composable<TeileZiel.PartsList> { entry ->
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val blick by navigation.blickfeld.collectAsStateWithLifecycle()
        val scan = navigation.partListsScan(entry)
        // Die Liste lebt im ViewModel des Ziels und ist bei der Rückkehr vom Scanner schon da.
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
                // Dieselbe Regel wie in der Webapp (sammlung.js): Mehr als
                // ein Mitglied im Haushalt heisst „es gibt Unterkonten".
                hatUnterkonten = blick.householdMembers.size > 1,
                barcodeSetNumber = scan.setNumber,
                onBarcodeConsumed = scan.uebernommen,
                listState = teilelistenState
            )
        }
    }
}

/**
 * Teile und Minifiguren auf breiten Fenstern: Liste links, Detail rechts, wie in der
 * Merkliste. Auf dem Telefon bleibt es beim Blatt (Teil aus Sets) bzw. der eigenen
 * Seite (manuell erfasst).
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

/** Dasselbe für Teile und Figuren; das Detail „in welchen Sets“ kommt vom ViewModel des Reiters. */
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
        // Typ, Nummer, Farbe, Titel des offenen manuellen Eintrags; Liste, weil sie sich speichern lässt.
        var manuell by rememberSaveable { mutableStateOf<List<String>?>(null) }
        val openManual: (Postenart, String, Int, String) -> Unit = { typ, id, farbe, titel ->
            if (sideBySide) {
                detailVm.closeSetItem()
                manuell = listOf(typ.kennung, id, farbe.toString(), titel)
            } else openSinglePiece(typ, id, farbe, titel)
        }
        val offen = manuell
        if (sideBySide && (setItem.offen || offen != null)) {
            // Die Kachel des offenen Teils ist markiert wie in Merkliste und Galerie.
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

/** Schlüssel der Teileliste im ScrollMemory; sie ist kein Reiter der unteren Leiste. */
private const val TEILELISTE_ROLLSCHLUESSEL = "partslist"
