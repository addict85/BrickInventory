package ch.brickinventoryapp.app.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.*
import ch.brickinventoryapp.teile.ui.dialogs.SetItemDetailDialog
import ch.brickinventoryapp.anmeldung.ui.*
import ch.brickinventoryapp.finanzen.ui.*
import ch.brickinventoryapp.katalog.ui.*
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.verwaltung.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.anmeldung.ui.screens.*
import ch.brickinventoryapp.finanzen.ui.screens.*
import ch.brickinventoryapp.katalog.ui.screens.*
import ch.brickinventoryapp.konto.ui.screens.*
import ch.brickinventoryapp.sammlung.ui.screens.*
import ch.brickinventoryapp.teile.ui.screens.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.verwaltung.ui.screens.*
import coil3.ImageLoader
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import ch.brickinventoryapp.app.*
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.toRoute
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListeUndDetail
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.MitZiel
import ch.brickinventoryapp.ui.components.detailSchluessel
import ch.brickinventoryapp.teile.ui.dialogs.SetItemDetailBereich

/** Navigationsziele des Bestands: Galerie, Teile, Minifiguren und ihre Details. */
fun NavGraphBuilder.collectionGraph(u: ZielUmgebung) {
    galerieZiele(u)
    setDetailZiel(u)
    teileZiele(u)
    figurenZiele(u)
    einzelstueckZiele(u.navController, u.imageLoader)
}

/** Die Galerie; auf breiten Fenstern steht das Set-Detail daneben ([setDetailZiel]). */
private fun NavGraphBuilder.galerieZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    val snackbarHostState = u.snackbarHostState
    val galleryGridState = u.rollen.galerie
    composable<Screen.Gallery> {
        val vm = u.aktivitaet.app
        val galerieVm: GalerieViewModel = hiltViewModel()
        val state by galerieVm.state.collectAsStateWithLifecycle()
        val galerie by galerieVm.galleryState.collectAsStateWithLifecycle()
        val erfassung = u.aktivitaet.erfassung
        val barcode by erfassung.barcodeState.collectAsStateWithLifecycle()
        // Retry loading if sets are empty and server URL is available
        LaunchedEffect(state.serverUrl) {
            if (state.serverUrl.isNotBlank() && galerie.sets.isEmpty() && !galerie.galleryLoading) {
                galerieVm.loadSets(); galerieVm.loadStats()
            }
        }
        // Rollposition ausdrücklich wiederherstellen — der hochgezogene Zustand allein
        // landet verschoben.
        ScrollPositionKeeper(
            Screen.Gallery.rollSchluessel, galleryGridState, galerie.sets.isNotEmpty(), vm.scrollMemory)

        // Gallery-Search: set found → navigate to detail
        LaunchedEffect(barcode.gefundenesSet) {
            val found = barcode.gefundenesSet
            if (found != null) {
                erfassung.gallerySearchFoundConsumed()
                navController.navigate(Screen.SetDetail(found))
            }
        }
        // Gelöscht wird erst, wenn die Snackbar ohne „Rückgängig“ endet — auch wenn
        // sie verschwindet, weil man die Galerie verlässt (finally).
        val vorgemerkt by galerieVm.vorgemerkt.collectAsStateWithLifecycle()
        val geloeschtText = vorgemerkt?.let { stringResource(R.string.vm_set_deleted, it.name) }
        val rueckgaengigText = stringResource(R.string.common_undo)
        LaunchedEffect(vorgemerkt) {
            if (vorgemerkt == null || geloeschtText == null) return@LaunchedEffect
            var zurueck = false
            try {
                zurueck = snackbarHostState.showSnackbar(geloeschtText, rueckgaengigText,
                    duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed
            } finally {
                if (zurueck) galerieVm.rueckgaengig() else galerieVm.loeschenAusfuehren()
            }
        }
        val ziel = this
        ReiterGeruest(stringResource(R.string.nav_collection), u) {
            MitZiel(ziel) {
            GalleryRoute(
                vm = galerieVm,
                erfassung = erfassung,
                imageLoader = imageLoader,
                onScanBarcode = { erfassung.setScannerSource("gallery_search"); navController.navigate(Screen.BarcodeScanner) },
                onSetClick = { navController.navigate(Screen.SetDetail(it)) },
                gridState = galleryGridState
            )
            }
        }
    }
}

/** Set-Detail; auf breiten Fenstern mit der Galerie links daneben. */
private fun NavGraphBuilder.setDetailZiel(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    composable<Screen.SetDetail> { backStack ->
        val vm = u.aktivitaet.app
        val state by vm.state.collectAsStateWithLifecycle()
        val setNumber = backStack.toRoute<Screen.SetDetail>().setNumber
        // Die Galerie liegt als Startziel immer darunter; ihre geladene
        // Kachel zeigt das Set sofort, bis das Detail da ist.
        val galerieEintrag = remember(backStack) {
            runCatching { navController.getBackStackEntry<Screen.Gallery>() }.getOrNull()
        }
        val galerieUnten = galerieEintrag?.let { hiltViewModel<GalerieViewModel>(it) }
        val vorschau = galerieUnten?.let { g ->
            val galerie by g.galleryState.collectAsStateWithLifecycle()
            galerie.sets.find { it.setNumber == setNumber }
        }
        val vorschauName = vorschau?.name
        val detailVm: SetDetailViewModel = hiltViewModel()
        val detail: @Composable () -> Unit = {
        SetDetailRoute(
            setNumber = setNumber,
            vm = detailVm,
            vorschau = vorschau,
            serverUrl = state.serverUrl,
            imageLoader = imageLoader,
            onBack = { navController.popBackStack() },
            // Zurück in die Galerie, die das Set mit „Rückgängig“ vormerkt; ohne
            // Galerie darunter (Einstieg von aussen) wird gleich gelöscht.
            onDelete = { sn ->
                val name = detailVm.setDetailState.value.setDetail?.name ?: vorschauName ?: sn
                if (galerieUnten != null) galerieUnten.loeschenVormerken(sn, name) else detailVm.deleteSet(sn)
                navController.popBackStack()
            },
            rueckgaengigMoeglich = galerieUnten != null,
            onNavigateToAcqMgmt = { type, id, colorId, title ->
                navController.navigate(Screen.AcquisitionManagement(Postenart.aus(type), id, colorId, title))
            },
            onOpenPdf = { url, title ->
                navController.navigate(Screen.PdfViewer(url, title))
            }
        )
        }
        // Auf breiten Fenstern steht die Galerie links daneben (Lesebreite.kt); ein
        // anderes Set ersetzt dieses Detail, statt sich darüber zu stapeln. Ohne
        // gemeinsames Bild: Kachel und Detail sind dann beide zu sehen.
        androidx.compose.foundation.layout.BoxWithConstraints {
            if (galerieUnten != null && listeUndDetail(maxWidth.value)) GalerieNebenDetailRoute(u, galerieUnten, setNumber, detail)
            else MitZiel(this@composable) { detail() }
        }
    }
}

/** Die Galerie links neben dem Set-Detail; ein anderes Set ersetzt das Detail, statt sich zu stapeln. */
@Composable
private fun GalerieNebenDetailRoute(u: ZielUmgebung, galerie: GalerieViewModel, setNumber: String, detail: @Composable () -> Unit) {
    val navController = u.navController
    val erfassung = u.aktivitaet.erfassung
    ReiterGeruest(stringResource(R.string.nav_collection), u) {
        ListeUndDetail(
            liste = {
                androidx.compose.runtime.CompositionLocalProvider(LocalOffenesDetail provides setNumber) {
                    GalleryRoute(
                        vm = galerie,
                        erfassung = erfassung,
                        imageLoader = u.imageLoader,
                        onScanBarcode = { erfassung.setScannerSource("gallery_search"); navController.navigate(Screen.BarcodeScanner) },
                        onSetClick = { sn ->
                            if (sn != setNumber) navController.navigate(Screen.SetDetail(sn)) {
                                popUpTo<Screen.SetDetail> { inclusive = true }
                            }
                        },
                        gridState = u.rollen.galerie,
                    )
                }
            },
            detail = detail,
        )
    }
}

/** Teile: Reiter mit Liste und Detail daneben. */
private fun NavGraphBuilder.teileZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    val partsGridState = u.rollen.teile
    composable<Screen.Parts> {
        val vm = u.aktivitaet.app
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
        ReiterGeruest(stringResource(R.string.nav_parts), u) {
            ScrollPositionKeeper(
                Screen.Parts.rollSchluessel, partsGridState,
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
            TeileListeUndDetailRoute(teileVm, imageLoader, state.serverUrl, navController) { oeffneManuell ->
                PartsRoute(
                    vm = teileVm,
                    imageLoader = imageLoader,
                    onOpenDetail = { partNumber, colorId ->
                        oeffneManuell("part", partNumber, colorId,
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

/** Minifiguren und der Vergleich. */
private fun NavGraphBuilder.figurenZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    val minifigsGridState = u.rollen.minifiguren
    composable<Screen.Minifigs> {
        val vm = u.aktivitaet.app
        val teileVm: TeileViewModel = hiltViewModel()
        val state by teileVm.state.collectAsStateWithLifecycle()
        val partsState by teileVm.partsState.collectAsStateWithLifecycle()
        LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank()) { if (partsState.minifigs.isEmpty()) teileVm.loadMinifigs() } }
        ReiterGeruest(stringResource(R.string.nav_minifigs), u) {
            ScrollPositionKeeper(
                Screen.Minifigs.rollSchluessel, minifigsGridState,
                // Auf abgeschlossen statt auf Inhalt prüfen, wie bei den Teilen: Sonst bekäme,
                // wer keine manuell erfassten Minifiguren hat, nie eine Position
                // wiederhergestellt.
                bereit = partsState.minifigs.isNotEmpty() && partsState.manualFigs != null,
                speicher = vm.scrollMemory,
                obenNachziehend = partsState.manualFigs?.size ?: 0)
            // Wie im Teile-Reiter; das Detail unterscheidet Teile und Figuren selbst.
            TeileListeUndDetailRoute(teileVm, imageLoader, state.serverUrl, navController) { oeffneManuell ->
                MinifigsRoute(
                    vm = teileVm,
                    imageLoader = imageLoader,
                    onOpenDetail = { figNumber ->
                        oeffneManuell("fig", figNumber, 0,
                            partsState.manualFigs?.find { it.figNumber == figNumber }
                                ?.figName ?: figNumber)
                    },
                    gridState = minifigsGridState
                )
            }
        }
    }
    composable<Screen.Comparison> {
        ReiterGeruest(stringResource(R.string.nav_comparison), u) {
            ComparisonScreen()
        }
    }
}

/** Seiten eines einzelnen Teils, einer Figur oder ihrer Käufe, ohne untere Leiste. */
private fun NavGraphBuilder.einzelstueckZiele(
    navController: NavHostController,
    imageLoader: coil3.ImageLoader,
) {
    // ── Detailansicht manueller Teile und Minifiguren ────────────────────
    // Ein ganzer Screen, kein Dialog mehr — Aufbau wie beim Set-Detail.
    composable<Screen.ManualItemDetail> { backStackEntry ->
        val ziel = backStackEntry.toRoute<Screen.ManualItemDetail>()
        val itemType  = ziel.art.kennung
        val itemId    = ziel.id
        val colorId   = ziel.colorId
        val itemTitle = ziel.title
        ManualItemDetailRoute(
            vm = hiltViewModel<KaeufeViewModel>(),
            teile = hiltViewModel(),
            type = itemType,
            id = itemId,
            colorId = colorId,
            fallbackTitle = itemTitle,
            imageLoader = imageLoader,
            onBack = { navController.popBackStack() },
            onNavigateToAcqMgmt = { t, i, c, title ->
                navController.navigate(Screen.AcquisitionManagement(Postenart.aus(t), i, c, title))
            },
            // Die Farbe ist Teil der Route und der Suche im Screen; nach einer Änderung
            // wird er mit der neuen Farbe neu geöffnet. Erst zurück, dann hin: Sonst
            // landete ein Zurück-Tipp auf genau der Farbe, die gerade korrigiert wurde.
            onFarbeGeaendert = { neueFarbe ->
                navController.popBackStack()
                navController.navigate(ziel.copy(colorId = neueFarbe))
            },
        )
    }

    composable<Screen.AcquisitionManagement> { backStackEntry ->
        val ziel = backStackEntry.toRoute<Screen.AcquisitionManagement>()
        AcquisitionManagementRoute(
            vm      = hiltViewModel<KaeufeViewModel>(),
            type    = ziel.art.kennung,
            id      = ziel.id,
            colorId = ziel.colorId,
            title   = ziel.title,
            onBack  = { navController.popBackStack() }
        )
    }
}

/**
 * Teile und Minifiguren auf breiten Fenstern: Liste links, Detail rechts, wie in der
 * Merkliste. Drei kleine Kacheln oben links auf leerer Fläche boten dem Tablet nichts;
 * jetzt bleibt die Liste stehen, während man Teil um Teil ansieht. Auf dem Telefon
 * bleibt es beim Blatt (Teil aus Sets) bzw. der eigenen Seite (manuell erfasst).
 */
@Composable
internal fun TeileListeUndDetailRoute(
    teileVm: TeileViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    navController: NavHostController,
    liste: @Composable (oeffneManuell: (String, String, Int, String) -> Unit) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val nebeneinander = listeUndDetail(maxWidth.value)
        val setItem by teileVm.setItemState.collectAsStateWithLifecycle()
        val lager by teileVm.lagerState.collectAsStateWithLifecycle()
        // Typ, Nummer, Farbe, Titel des offenen manuellen Eintrags; Liste, weil sie sich speichern lässt.
        var manuell by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<List<String>?>(null) }
        val oeffneManuell: (String, String, Int, String) -> Unit = { typ, id, farbe, titel ->
            if (nebeneinander) {
                teileVm.schliesseSetItem()
                manuell = listOf(typ, id, farbe.toString(), titel)
            } else navController.navigate(Screen.ManualItemDetail(Postenart.aus(typ), id, farbe, titel))
        }
        val oeffneSet: (String) -> Unit = { navController.navigate(Screen.SetDetail(it)) }
        val offen = manuell
        if (nebeneinander && (setItem.offen || offen != null)) {
            // Die Kachel des offenen Teils ist markiert wie in Merkliste und Galerie.
            val offenesTeil = setItem.art?.let { art ->
                detailSchluessel(art, setItem.nummer,
                    setItem.colorId.takeIf { art == "part" })
            }
            ListeUndDetail(
                liste = {
                    androidx.compose.runtime.CompositionLocalProvider(
                        LocalOffenesDetail provides offenesTeil) {
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
                            type = offen[0],
                            id = offen[1],
                            colorId = offen[2].toInt(),
                            fallbackTitle = offen[3],
                            imageLoader = imageLoader,
                            onBack = { manuell = null },
                            onNavigateToAcqMgmt = { t, i, c, title ->
                                navController.navigate(Screen.AcquisitionManagement(Postenart.aus(t), i, c, title))
                            },
                            onFarbeGeaendert = { neueFarbe -> manuell = listOf(offen[0], offen[1], neueFarbe.toString(), offen[3]) },
                        )
                    }
                },
            )
        } else liste(oeffneManuell)
        if (!nebeneinander) SetItemDetailDialog(setItem, lager, teileVm, imageLoader, serverUrl, oeffneSet)
    }
}
