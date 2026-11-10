package ch.brickinventoryapp.sammlung.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.sammlung.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.sammlung.ui.screens.ComparisonScreen
import ch.brickinventoryapp.sammlung.ui.screens.GalleryRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerklisteRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerkpostenDetailRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerkpostenRueckgaengigRoute
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailRoute
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.components.ListeUndDetail
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.MitZiel
import ch.brickinventoryapp.ui.listeUndDetail
import ch.brickinventoryapp.zustand.ui.Bereichsumgebung
import ch.brickinventoryapp.zustand.ui.Screen
import ch.brickinventoryapp.zustand.ui.rollSchluessel
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel

/**
 * Was die Sammlung von der App braucht. Die Erfassung lebt mit der Activity: Ihr
 * Bestätigungsdialog und die Prüfanzeige stehen über jedem Bildschirm.
 */
interface SammlungNavigation : Bereichsumgebung {
    val erfassung: ErfassungViewModel
}

/** Galerie, Set-Detail, Käufe, Merkliste, Scanner und Preisvergleich. */
fun NavGraphBuilder.sammlungGraph(navigation: SammlungNavigation) {
    galerieZiel(navigation)
    setDetailZiel(navigation)
    merklisteZiele(navigation)
    composable<Screen.AcquisitionManagement> { backStackEntry ->
        val ziel = backStackEntry.toRoute<Screen.AcquisitionManagement>()
        AcquisitionManagementRoute(
            vm      = hiltViewModel<KaeufeViewModel>(),
            type    = ziel.art,
            id      = ziel.id,
            colorId = ziel.colorId,
            title   = ziel.title,
            onBack  = { navigation.navController.popBackStack() }
        )
    }
    scannerZiel(navigation)
    composable<Screen.Comparison> {
        navigation.Reiter(stringResource(R.string.nav_comparison)) {
            ComparisonScreen()
        }
    }
}

/**
 * Der Merkposten zu [setNumber] — für Bereiche, die die Merkliste nicht kennen
 * (Katalog). Das ViewModel hängt am Ziel, das fragt.
 */
@Composable
fun gemerkterPosten(setNumber: String): MerkpostenAnsicht? {
    val merkliste: MerklisteViewModel = hiltViewModel()
    val liste by merkliste.merklisteState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { merkliste.ladeMerkliste() }
    return liste.merkposten.firstOrNull { it.setNumber == setNumber }
}

/** Merkposten und Preisalarm in einem Griff; die Regel steht im MerklisteViewModel. */
@Composable
fun merkpostenMitAlarm(): (String, Zustand, String, String, Int?) -> Unit {
    val merkliste: MerklisteViewModel = hiltViewModel()
    return merkliste::merkpostenMitAlarm
}

/** Die Galerie; auf breiten Fenstern steht das Set-Detail daneben ([setDetailZiel]). */
private fun NavGraphBuilder.galerieZiel(navigation: SammlungNavigation) {
    val navController = navigation.navController
    val galleryGridState = navigation.rollen.galerie
    composable<Screen.Gallery> {
        val vm = navigation.app
        val galerieVm: GalerieViewModel = hiltViewModel()
        val state by galerieVm.state.collectAsStateWithLifecycle()
        val galerie by galerieVm.galleryState.collectAsStateWithLifecycle()
        val erfassung = navigation.erfassung
        val barcode by erfassung.barcodeState.collectAsStateWithLifecycle()
        // Nachladen, wenn die Galerie leer ist und eine Serveradresse da ist.
        LaunchedEffect(state.serverUrl) {
            if (state.serverUrl.isNotBlank() && galerie.sets.isEmpty() && !galerie.galleryLoading) {
                galerieVm.loadSets(); galerieVm.loadStats()
            }
        }
        // Rollposition ausdrücklich wiederherstellen — der hochgezogene Zustand allein
        // landet verschoben.
        ScrollPositionKeeper(
            Screen.Gallery.rollSchluessel, galleryGridState, galerie.sets.isNotEmpty(), vm.scrollMemory)

        // Suche per Scan: Ein vorhandenes Set öffnet sein Detail.
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
                zurueck = navigation.snackbar.showSnackbar(geloeschtText, rueckgaengigText,
                    duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed
            } finally {
                if (zurueck) galerieVm.rueckgaengig() else galerieVm.loeschenAusfuehren()
            }
        }
        val ziel = this
        navigation.Reiter(stringResource(R.string.nav_collection)) {
            MitZiel(ziel) {
            GalleryRoute(
                vm = galerieVm,
                erfassung = erfassung,
                imageLoader = navigation.bilder,
                onScanBarcode = { navController.navigate(Screen.BarcodeScanner(Scannerherkunft.GALERIE_SUCHE)) },
                onSetClick = { navController.navigate(Screen.SetDetail(it)) },
                gridState = galleryGridState
            )
            }
        }
    }
}

/** Set-Detail; auf breiten Fenstern mit der Galerie links daneben. */
private fun NavGraphBuilder.setDetailZiel(navigation: SammlungNavigation) {
    val navController = navigation.navController
    composable<Screen.SetDetail> { backStack ->
        val vm = navigation.app
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
            imageLoader = navigation.bilder,
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
                navController.navigate(Screen.AcquisitionManagement(type, id, colorId, title))
            },
            onOpenPdf = { url, title ->
                navController.navigate(Screen.PdfViewer(url, title))
            }
        )
        }
        // Auf breiten Fenstern steht die Galerie links daneben (Lesebreite.kt); ein
        // anderes Set ersetzt dieses Detail, statt sich darüber zu stapeln. Ohne
        // gemeinsames Bild: Kachel und Detail sind dann beide zu sehen.
        BoxWithConstraints {
            if (galerieUnten != null && listeUndDetail(maxWidth.value)) GalerieNebenDetailRoute(navigation, galerieUnten, setNumber, detail)
            else MitZiel(this@composable) { detail() }
        }
    }
}

/** Die Galerie links neben dem Set-Detail; ein anderes Set ersetzt das Detail, statt sich zu stapeln. */
@Composable
private fun GalerieNebenDetailRoute(navigation: SammlungNavigation, galerie: GalerieViewModel, setNumber: String, detail: @Composable () -> Unit) {
    val navController = navigation.navController
    navigation.Reiter(stringResource(R.string.nav_collection)) {
        ListeUndDetail(
            liste = {
                CompositionLocalProvider(LocalOffenesDetail provides setNumber) {
                    GalleryRoute(
                        vm = galerie,
                        erfassung = navigation.erfassung,
                        imageLoader = navigation.bilder,
                        onScanBarcode = { navController.navigate(Screen.BarcodeScanner(Scannerherkunft.GALERIE_SUCHE)) },
                        onSetClick = { sn ->
                            if (sn != setNumber) navController.navigate(Screen.SetDetail(sn)) {
                                popUpTo<Screen.SetDetail> { inclusive = true }
                            }
                        },
                        gridState = navigation.rollen.galerie,
                    )
                }
            },
            detail = detail,
        )
    }
}

/**
 * Die Merkliste steht in der Sammlung: Ein Merkposten ist ein Set, das man noch
 * nicht hat. Der häufigste Weg hinein kommt aus dem Katalog.
 */
private fun NavGraphBuilder.merklisteZiele(navigation: SammlungNavigation) {
    val navController = navigation.navController
    composable<Screen.Wanted> {
        // Auf breiten Fenstern Liste und Detail nebeneinander (Lesebreite.kt).
        BoxWithConstraints {
            val nebeneinander = listeUndDetail(maxWidth.value)
            navigation.Reiter(stringResource(R.string.nav_wanted)) {
                val merkliste = hiltViewModel<MerklisteViewModel>()
                MerkpostenRueckgaengigRoute(merkliste, navigation.snackbar)
                MerklisteRoute(
                    vm = merkliste,
                    imageLoader = navigation.bilder,
                    nebeneinander = nebeneinander,
                    onScan = { navController.navigate(Screen.BarcodeScanner(Scannerherkunft.MERKLISTE)) },
                    onOeffnenEinzeln = { sn, zustand ->
                        navController.navigate(Screen.MerkpostenDetail(sn, zustand))
                    },
                )
            }
        }
    }
    composable<Screen.MerkpostenDetail> { backStack ->
        val ziel = backStack.toRoute<Screen.MerkpostenDetail>()
        // Dasselbe ViewModel wie die Liste darunter: Dort läuft die Snackbar mit
        // „Rückgängig“, nachdem das Detail eines gelöschten Postens zurückgegangen ist.
        val liste = remember(backStack) { runCatching { navController.getBackStackEntry<Screen.Wanted>() }.getOrNull() }
        MerkpostenDetailRoute(
            vm = if (liste != null) hiltViewModel<MerklisteViewModel>(liste) else hiltViewModel<MerklisteViewModel>(),
            setNumber = ziel.setNumber,
            condition = ziel.condition,
            imageLoader = navigation.bilder,
            onBack = { navController.popBackStack() },
        )
    }
}

/** Der Scanner; was ein Treffer auslöst, sagt die Herkunft in der Route. */
private fun NavGraphBuilder.scannerZiel(navigation: SammlungNavigation) {
    val navController = navigation.navController
    composable<Screen.BarcodeScanner> { eintrag ->
        val erfassung = navigation.erfassung
        val herkunft = eintrag.toRoute<Screen.BarcodeScanner>().herkunft
        BarcodeScannerScreen(
            // Texterkennung nur hier: Dieser Scanner bedient „Set hinzufügen“ (Galerie) und
            // „Teileliste hinzufügen“. Der Preisvergleich hat einen eigenen Aufruf und lässt
            // den Standard aus.
            ocrEnabled = true,
            onResult = { scannedValue ->
                navController.popBackStack()
                erfassung.resolveBarcode(scannedValue, herkunft)
            },
            // Die Texterkennung liefert die Setnummer fertig — der Umweg über die
            // EAN-Auflösung entfällt, das spart je Scan bis zu acht Rebrickable-Aufrufe.
            onSetNumberResult = { setNumber ->
                navController.popBackStack()
                erfassung.useScannedSetNumber(setNumber, herkunft)
            },
            onDismiss = { navController.popBackStack() }
        )
    }
}
