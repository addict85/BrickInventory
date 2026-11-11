package ch.brickinventoryapp.teile.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
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
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListeUndDetail
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.detailSchluessel
import ch.brickinventoryapp.ui.listeUndDetail
import ch.brickinventoryapp.zustand.ui.Bereichsumgebung
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

/** Teile: Reiter mit Liste und Detail daneben. */
private fun NavGraphBuilder.teileZiel(navigation: TeileNavigation) {
    val partsGridState = navigation.rollen.teile
    composable<TeileZiel.Parts> {
        val vm = navigation.app
        val teileVm: TeileViewModel = hiltViewModel()
        val state by teileVm.state.collectAsStateWithLifecycle()
        val partsState by teileVm.partsState.collectAsStateWithLifecycle()
        LaunchedEffect(state.serverUrl) {
            if (state.serverUrl.isNotBlank()) {
                teileVm.loadParts()
                // Farbkatalog fuer den Erfassungsdialog …
                teileVm.loadPartsColors()
                // … und die beiden Filterlisten mit ihren Zählwerten. Zwei verschiedene
                // Adressen, siehe TeileApi.getPartsFilterColors.
                teileVm.loadPartsFilters()
            }
        }
        navigation.Reiter(stringResource(R.string.nav_parts)) {
            ScrollPositionKeeper(
                TeileZiel.Parts.rollSchluessel, partsGridState,
                // Beide Ladevorgänge, nicht nur die Set-Teile. `manualParts != null` heisst
                // „die Antwort ist zurück“ — auch bei null manuell erfassten Teilen. Mit
                // `isNotEmpty()` würde die Position bei jemandem ohne eigene Teile nie
                // wiederhergestellt.
                bereit = partsState.parts.isNotEmpty() && partsState.manualParts != null,
                speicher = vm.scrollMemory,
                obenNachziehend = partsState.manualParts?.size ?: 0)
            // Das Detail eines Teils (aus Sets oder manuell) steht auf dem Tablet neben
            // der Liste, auf dem Telefon als Blatt bzw. eigene Seite. Hier und nicht im
            // Bildschirm, weil nur der Graph den NavController kennt.
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
    val minifigsGridState = navigation.rollen.minifiguren
    composable<TeileZiel.Minifigs> {
        val vm = navigation.app
        val teileVm: TeileViewModel = hiltViewModel()
        val state by teileVm.state.collectAsStateWithLifecycle()
        val partsState by teileVm.partsState.collectAsStateWithLifecycle()
        LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) { if (partsState.minifigs.isEmpty()) teileVm.loadMinifigs() } }
        navigation.Reiter(stringResource(R.string.nav_minifigs)) {
            ScrollPositionKeeper(
                TeileZiel.Minifigs.rollSchluessel, minifigsGridState,
                // Auf abgeschlossen statt auf Inhalt prüfen, wie bei den Teilen: Sonst bekäme,
                // wer keine manuell erfassten Minifiguren hat, nie eine Position
                // wiederhergestellt.
                bereit = partsState.minifigs.isNotEmpty() && partsState.manualFigs != null,
                speicher = vm.scrollMemory,
                obenNachziehend = partsState.manualFigs?.size ?: 0)
            // Wie im Teile-Reiter; das Detail unterscheidet Teile und Figuren selbst.
            TeileListeUndDetailRoute(teileVm, navigation.bilder, state.serverUrl,
                navigation::oeffneEinzelstueck, navigation::oeffneSet, navigation::oeffneKaeufe) { oeffneManuell ->
                MinifigsRoute(
                    vm = teileVm,
                    imageLoader = navigation.bilder,
                    onOpenDetail = { figNumber ->
                        oeffneManuell(Postenart.FIG, figNumber, 0,
                            partsState.manualFigs?.find { it.figNumber == figNumber }
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
        ManualItemDetailRoute(
            vm = hiltViewModel<KaeufeViewModel>(),
            teile = hiltViewModel(),
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
        val vm = navigation.app
        val state by vm.state.collectAsStateWithLifecycle()
        val blick by vm.blickfeld.collectAsStateWithLifecycle()
        val scan = navigation.teilelistenScan(eintrag)
        navigation.Reiter(stringResource(R.string.nav_partslist)) {
            PartsListRoute(
                serverUrl = state.serverUrl,
                imageLoader = navigation.bilder,
                onScanBarcode = { navigation.oeffneScanner(Scannerherkunft.TEILELISTE) },
                // Erfolgloser Scan → Cursor ins Set-Feld.
                manuelleErfassungAnfordern = scan.manuellErfassen,
                onManuelleErfassungQuittiert = scan.manuellQuittiert,
                // Dieselbe Regel wie in der Webapp (gallery.js): Mehr als
                // ein Mitglied im Haushalt heisst „es gibt Unterkonten".
                hatUnterkonten = blick.householdMembers.size > 1,
                barcodeSetNumber = scan.setNumber,
                onBarcodeConsumed = scan.uebernommen,
                listState = navigation.rollen.teileliste
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
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val nebeneinander = listeUndDetail(maxWidth.value)
        val setItem by teileVm.setItemState.collectAsStateWithLifecycle()
        val lager by teileVm.lagerState.collectAsStateWithLifecycle()
        // Typ, Nummer, Farbe, Titel des offenen manuellen Eintrags; Liste, weil sie sich speichern lässt.
        var manuell by rememberSaveable { mutableStateOf<List<String>?>(null) }
        val oeffneManuell: (Postenart, String, Int, String) -> Unit = { typ, id, farbe, titel ->
            if (nebeneinander) {
                teileVm.schliesseSetItem()
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
                        SetItemDetailBereich(setItem, lager, teileVm, imageLoader, serverUrl, oeffneSet)
                    } else if (offen != null) key(offen) {
                        ManualItemDetailRoute(
                            vm = hiltViewModel<KaeufeViewModel>(),
                            teile = teileVm,
                            type = Postenart.aus(offen[0]),
                            id = offen[1],
                            colorId = offen[2].toInt(),
                            fallbackTitle = offen[3],
                            imageLoader = imageLoader,
                            onBack = { manuell = null },
                            onNavigateToAcqMgmt = oeffneKaeufe,
                            onFarbeGeaendert = { neueFarbe -> manuell = listOf(offen[0], offen[1], neueFarbe.toString(), offen[3]) },
                        )
                    }
                },
            )
        } else liste(oeffneManuell)
        if (!nebeneinander) SetItemDetailDialog(setItem, lager, teileVm, imageLoader, serverUrl, oeffneSet)
    }
}
