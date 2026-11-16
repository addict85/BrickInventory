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
import ch.brickinventoryapp.teile.ui.dialogs.SetItemDetailBereich
import ch.brickinventoryapp.teile.ui.dialogs.SetItemDetailDialog
import ch.brickinventoryapp.teile.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.teile.ui.screens.MinifigsRoute
import ch.brickinventoryapp.teile.ui.screens.PartsListRoute
import ch.brickinventoryapp.teile.ui.screens.PartsRoute
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.FigurenViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.MitSetItem
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListeUndDetail
import ch.brickinventoryapp.ui.components.RueckgaengigMeldung
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.detailSchluessel
import ch.brickinventoryapp.ui.listeUndDetail
import ch.brickinventoryapp.navigation.Bereichsumgebung
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import coil3.ImageLoader

/** Was der Scanner für die Teileliste gefunden hat, samt den Quittungen. */
class TeilelistenScan(
    /** Die gescannte Setnummer, bis die Teileliste sie übernommen hat. */
    val setNumber: String?,
    /** Der Scan blieb ohne Nummer: Der Cursor soll ins Set-Feld. */
    val manuellErfassen: Boolean,
    val uebernommen: () -> Unit,
    val manuellQuittiert: () -> Unit,
)

/**
 * Was Teile und Figuren von der App brauchen: den Scan, den die Sammlung am Ziel
 * [eintrag] auflöst, und die Ziele der Sammlung (Set, Käufe, Scanner).
 */
interface TeileNavigation : Bereichsumgebung {
    @Composable
    fun teilelistenScan(eintrag: NavBackStackEntry): TeilelistenScan

    fun oeffneSet(setNumber: String)
    fun oeffneKaeufe(art: Postenart, id: String, colorId: Int, titel: String)
    fun oeffneScanner(herkunft: Scannerherkunft)
}

/** Teile, Minifiguren, ihre Einzelseiten und die Teileliste. */
fun NavGraphBuilder.teileGraph(navigation: TeileNavigation) {
    teileZiel(navigation)
    figurenZiel(navigation)
    einzelstueckZiel(navigation)
    teilelistenZiel(navigation)
}

/** Teile: Reiter mit Liste und Detail daneben. Liste und Filterwerte lädt das ViewModel beim Beobachten. */
private fun NavGraphBuilder.teileZiel(navigation: TeileNavigation) {
    composable<TeileZiel.Parts> {
        // Ein Zustand je Besuch; die Stelle hält allein der ScrollMemory (Keeper unten).
        val partsGridState = remember { LazyGridState() }
        val teileVm: TeileViewModel = hiltViewModel()
        val state by teileVm.state.collectAsStateWithLifecycle()
        val partsState by teileVm.teileState.collectAsStateWithLifecycle()
        val teilWeg = teileVm.loeschen.wert.collectAsStateWithLifecycle().value
        RueckgaengigMeldung(teilWeg, stringResource(R.string.vm_set_deleted, teilWeg?.name.orEmpty()), navigation.snackbar,
            teileVm.loeschen::rueckgaengig, teileVm.loeschen::ausfuehren)
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
            TeileListeUndDetailRoute(teileVm, navigation.bilder, state.serverUrl,
                navigation::oeffneEinzelstueck, navigation::oeffneSet, navigation::oeffneKaeufe) { oeffneManuell ->
                PartsRoute(
                    vm = teileVm,
                    imageLoader = navigation.bilder,
                    onOpenDetail = { partNumber, colorId ->
                        oeffneManuell(Postenart.PART, partNumber, colorId,
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
private fun NavGraphBuilder.figurenZiel(navigation: TeileNavigation) {
    composable<TeileZiel.Minifigs> {
        val minifigsGridState = remember { LazyGridState() }
        val figurenVm: FigurenViewModel = hiltViewModel()
        val state by figurenVm.sitzungsWerte.collectAsStateWithLifecycle()
        val figuren by figurenVm.figurenZustand.collectAsStateWithLifecycle()
        val figurWeg = figurenVm.loeschen.wert.collectAsStateWithLifecycle().value
        RueckgaengigMeldung(figurWeg, stringResource(R.string.vm_set_deleted, figurWeg?.name.orEmpty()), navigation.snackbar,
            figurenVm.loeschen::rueckgaengig, figurenVm.loeschen::ausfuehren)
        navigation.Reiter(stringResource(R.string.nav_minifigs)) {
            ScrollPositionKeeper(
                TeileZiel.Minifigs.rollSchluessel, minifigsGridState,
                // Auf abgeschlossen statt auf Inhalt prüfen, wie bei den Teilen.
                bereit = figuren.minifigs.isNotEmpty() && figuren.manualFigs != null,
                speicher = navigation.rollgedaechtnis,
                obenNachziehend = figuren.manualFigs?.size ?: 0)
            ListeUndDetailRoute(figurenVm, navigation.bilder, state.serverUrl,
                navigation::oeffneEinzelstueck, navigation::oeffneSet, navigation::oeffneKaeufe) { oeffneManuell ->
                MinifigsRoute(
                    vm = figurenVm,
                    imageLoader = navigation.bilder,
                    onOpenDetail = { figNumber ->
                        oeffneManuell(Postenart.FIG, figNumber, 0,
                            figuren.manualFigs?.find { it.figNumber == figNumber }
                                ?.figName ?: figNumber)
                    },
                    gridState = minifigsGridState
                )
            }
        }
    }
}

private fun TeileNavigation.oeffneEinzelstueck(art: Postenart, id: String, farbe: Int, titel: String) =
    navController.navigate(TeileZiel.ManualItemDetail(art, id, farbe, titel))

/** Detailseite manueller Teile und Minifiguren; Aufbau wie beim Set-Detail. */
private fun NavGraphBuilder.einzelstueckZiel(navigation: TeileNavigation) {
    val navController = navigation.navController
    composable<TeileZiel.ManualItemDetail> { backStackEntry ->
        val ziel = backStackEntry.toRoute<TeileZiel.ManualItemDetail>()
        // Liegt der Reiter darunter, löscht das Detail über dessen ViewModel mit „Rückgängig“;
        // das eigene endete mit dem Zurückgehen und nähme das Vorgemerkte mit.
        val reiter = remember(backStackEntry) {
            runCatching {
                if (ziel.art == Postenart.FIG) navController.getBackStackEntry<TeileZiel.Minifigs>()
                else navController.getBackStackEntry<TeileZiel.Parts>()
            }.getOrNull()
        }
        ManualItemDetailRoute(
            vm = hiltViewModel<KaeufeViewModel>(),
            teile = reiter?.takeIf { ziel.art != Postenart.FIG }?.let { hiltViewModel<TeileViewModel>(it) } ?: hiltViewModel(),
            figuren = reiter?.takeIf { ziel.art == Postenart.FIG }?.let { hiltViewModel<FigurenViewModel>(it) } ?: hiltViewModel(),
            rueckgaengig = reiter != null,
            type = ziel.art,
            id = ziel.id,
            colorId = ziel.colorId,
            fallbackTitle = ziel.title,
            imageLoader = navigation.bilder,
            onBack = { navController.popBackStack() },
            onNavigateToAcqMgmt = navigation::oeffneKaeufe,
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
private fun NavGraphBuilder.teilelistenZiel(navigation: TeileNavigation) {
    val navController = navigation.navController
    composable<TeileZiel.PartsList> { eintrag ->
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val blick by navigation.blickfeld.collectAsStateWithLifecycle()
        val scan = navigation.teilelistenScan(eintrag)
        // Die Liste lebt im ViewModel des Ziels und ist bei der Rückkehr vom Scanner schon da.
        val teilelistenState = remember { LazyListState() }
        ScrollPositionKeeper(TEILELISTE_ROLLSCHLUESSEL, teilelistenState, bereit = true, speicher = navigation.rollgedaechtnis)
        navigation.Reiter(stringResource(R.string.nav_partslist)) {
            PartsListRoute(
                serverUrl = state.serverUrl,
                imageLoader = navigation.bilder,
                onScanBarcode = { navigation.oeffneScanner(Scannerherkunft.TEILELISTE) },
                // Erfolgloser Scan → Cursor ins Set-Feld.
                manuelleErfassungAnfordern = scan.manuellErfassen,
                onManuelleErfassungQuittiert = scan.manuellQuittiert,
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
fun TeileListeUndDetailRoute(
    teileVm: TeileViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    oeffneEinzelstueck: (Postenart, String, Int, String) -> Unit,
    oeffneSet: (String) -> Unit,
    oeffneKaeufe: (Postenart, String, Int, String) -> Unit,
    liste: @Composable (oeffneManuell: (Postenart, String, Int, String) -> Unit) -> Unit,
) = ListeUndDetailRoute(teileVm, imageLoader, serverUrl, oeffneEinzelstueck, oeffneSet, oeffneKaeufe, liste)

/** Dasselbe für Teile und Figuren; das Detail „in welchen Sets“ kommt vom ViewModel des Reiters. */
@Composable
internal fun ListeUndDetailRoute(
    detailVm: MitSetItem,
    imageLoader: ImageLoader,
    serverUrl: String,
    oeffneEinzelstueck: (Postenart, String, Int, String) -> Unit,
    oeffneSet: (String) -> Unit,
    oeffneKaeufe: (Postenart, String, Int, String) -> Unit,
    liste: @Composable (oeffneManuell: (Postenart, String, Int, String) -> Unit) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val nebeneinander = listeUndDetail(maxWidth.value)
        val setItem by detailVm.setItemState.collectAsStateWithLifecycle()
        val lager by detailVm.lagerState.collectAsStateWithLifecycle()
        // Typ, Nummer, Farbe, Titel des offenen manuellen Eintrags; Liste, weil sie sich speichern lässt.
        var manuell by rememberSaveable { mutableStateOf<List<String>?>(null) }
        val oeffneManuell: (Postenart, String, Int, String) -> Unit = { typ, id, farbe, titel ->
            if (nebeneinander) {
                detailVm.schliesseSetItem()
                manuell = listOf(typ.kennung, id, farbe.toString(), titel)
            } else oeffneEinzelstueck(typ, id, farbe, titel)
        }
        val offen = manuell
        if (nebeneinander && (setItem.offen || offen != null)) {
            // Die Kachel des offenen Teils ist markiert wie in Merkliste und Galerie.
            val offenesTeil = setItem.art?.let { art ->
                detailSchluessel(art.kennung, setItem.nummer,
                    setItem.colorId.takeIf { art == Postenart.PART })
            }
            ListeUndDetail(
                liste = {
                    CompositionLocalProvider(LocalOffenesDetail provides offenesTeil) {
                        liste(oeffneManuell)
                    }
                },
                detail = {
                    if (setItem.offen) {
                        SetItemDetailBereich(setItem, lager, detailVm, imageLoader, serverUrl, oeffneSet)
                    } else if (offen != null) key(offen) {
                        ManualItemDetailRoute(
                            vm = hiltViewModel<KaeufeViewModel>(),
                            teile = detailVm as? TeileViewModel ?: hiltViewModel<TeileViewModel>(),
                            figuren = detailVm as? FigurenViewModel ?: hiltViewModel<FigurenViewModel>(),
                            type = Postenart.aus(offen[0]),
                            id = offen[1],
                            colorId = offen[2].toInt(),
                            fallbackTitle = offen[3],
                            imageLoader = imageLoader,
                            onBack = { manuell = null },
                            onNavigateToAcqMgmt = oeffneKaeufe,
                            onFarbeGeaendert = { neueFarbe -> manuell = listOf(offen[0], offen[1], neueFarbe.toString(), offen[3]) },
                            rueckgaengig = (detailVm is FigurenViewModel) == (offen[0] == Postenart.FIG.kennung),
                        )
                    }
                },
            )
        } else liste(oeffneManuell)
        if (!nebeneinander) SetItemDetailDialog(setItem, lager, detailVm, imageLoader, serverUrl, oeffneSet)
    }
}

/** Schlüssel der Teileliste im ScrollMemory; sie ist kein Reiter der unteren Leiste. */
private const val TEILELISTE_ROLLSCHLUESSEL = "partslist"
