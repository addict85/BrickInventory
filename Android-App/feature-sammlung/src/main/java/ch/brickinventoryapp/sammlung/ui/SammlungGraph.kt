package ch.brickinventoryapp.sammlung.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.sammlung.ui.screens.BarcodeScannerScreen
import ch.brickinventoryapp.sammlung.ui.screens.ComparisonScreen
import ch.brickinventoryapp.sammlung.ui.screens.GalerieRueckgaengigRoute
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
import ch.brickinventoryapp.navigation.Bereichsumgebung
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel

/** Was die Sammlung von der App braucht; die Erfassung hängt am Ziel, das scannt. */
interface SammlungNavigation : Bereichsumgebung {
    /** Den PDF-Betrachter hält die Finanzen-Seite. */
    fun oeffnePdf(url: String, titel: String)
}

/** Galerie, Set-Detail, Käufe, Merkliste, Scanner und Preisvergleich. */
fun NavGraphBuilder.sammlungGraph(navigation: SammlungNavigation) {
    galerieZiel(navigation)
    setDetailZiel(navigation)
    merklisteZiele(navigation)
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
    scannerZiel(navigation)
    composable<SammlungZiel.Comparison> {
        navigation.Reiter(stringResource(R.string.nav_comparison)) {
            ComparisonScreen()
        }
    }
}

/** Die Galerie; auf breiten Fenstern steht das Set-Detail daneben ([setDetailZiel]). */
private fun NavGraphBuilder.galerieZiel(navigation: SammlungNavigation) {
    val navController = navigation.navController
    composable<SammlungZiel.Gallery> { eintrag ->
        val galerieVm: GalerieViewModel = hiltViewModel()
        val state by galerieVm.state.collectAsStateWithLifecycle()
        val galerie by galerieVm.galleryState.collectAsStateWithLifecycle()
        val erfassung: ErfassungViewModel = hiltViewModel()
        Erfassungsrahmen(eintrag, erfassung, navigation.bilder) { navController.navigate(SammlungZiel.SetDetail(it)) }
        LaunchedEffect(state.serverUrl) { galerieVm.ladeWennLeer() }
        // Ein Zustand je Besuch; die Stelle hält allein der ScrollMemory.
        val galleryGridState = remember { LazyGridState() }
        ScrollPositionKeeper(
            SammlungZiel.Gallery.rollSchluessel, galleryGridState, galerie.sets.isNotEmpty(), navigation.rollgedaechtnis)
        // Das Set-Detail gibt ein gelöschtes Set als Ergebnis an diesen Eintrag zurück;
        // die Galerie merkt es mit „Rückgängig“ vor. Kein Zugriff auf ihr ViewModel von aussen.
        val zuLoeschen by eintrag.savedStateHandle.getStateFlow<ArrayList<String>?>(LOESCHEN_VORMERKEN, null)
            .collectAsStateWithLifecycle()
        LaunchedEffect(zuLoeschen) {
            val (sn, name) = zuLoeschen ?: return@LaunchedEffect
            galerieVm.loeschenVormerken(sn, name)
            eintrag.savedStateHandle[LOESCHEN_VORMERKEN] = null
        }

        GalerieRueckgaengigRoute(galerieVm, navigation.snackbar)
        val ziel = this
        navigation.Reiter(stringResource(R.string.nav_collection)) {
            MitZiel(ziel) {
            GalleryRoute(
                vm = galerieVm,
                erfassung = erfassung,
                imageLoader = navigation.bilder,
                onScanBarcode = { navController.navigate(SammlungZiel.BarcodeScanner(Scannerherkunft.GALERIE_SUCHE)) },
                onSetClick = { navController.navigate(SammlungZiel.SetDetail(it)) },
                gridState = galleryGridState
            )
            }
        }
    }
}

/** Set-Detail; auf breiten Fenstern mit der Galerie links daneben. */
private fun NavGraphBuilder.setDetailZiel(navigation: SammlungNavigation) {
    val navController = navigation.navController
    composable<SammlungZiel.SetDetail> { backStack ->
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val setNumber = backStack.toRoute<SammlungZiel.SetDetail>().setNumber
        // Liegt die Galerie darunter (Startziel), nimmt sie ein gelöschtes Set als Ergebnis
        // entgegen und bietet „Rückgängig“ an.
        val galerieEintrag = remember(backStack) {
            runCatching { navController.getBackStackEntry<SammlungZiel.Gallery>() }.getOrNull()
        }
        val detailVm: SetDetailViewModel = hiltViewModel()
        // Die Kachel aus der Ablage zeigt das Set sofort, bis das Detail da ist.
        val vorschau by detailVm.vorschau.collectAsStateWithLifecycle()
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
                val name = detailVm.setDetailState.value.setDetail?.name ?: vorschau?.name ?: sn
                if (galerieEintrag != null) galerieEintrag.savedStateHandle[LOESCHEN_VORMERKEN] = arrayListOf(sn, name)
                else detailVm.deleteSet(sn)
                navController.popBackStack()
            },
            rueckgaengigMoeglich = galerieEintrag != null,
            onNavigateToAcqMgmt = { type, id, colorId, title ->
                navController.navigate(SammlungZiel.AcquisitionManagement(type, id, colorId, title))
            },
            onOpenPdf = navigation::oeffnePdf
        )
        }
        // Auf breiten Fenstern steht die Galerie links daneben (Lesebreite.kt); ein
        // anderes Set ersetzt dieses Detail, statt sich darüber zu stapeln. Ohne
        // gemeinsames Bild: Kachel und Detail sind dann beide zu sehen.
        BoxWithConstraints {
            if (galerieEintrag != null && listeUndDetail(maxWidth.value))
                GalerieNebenDetailRoute(navigation, backStack, galerieEintrag, setNumber, detail)
            else MitZiel(this@composable) { detail() }
        }
    }
}

/** Die Galerie links neben dem Set-Detail; ein anderes Set ersetzt das Detail, statt sich zu stapeln. */
@Composable
private fun GalerieNebenDetailRoute(
    navigation: SammlungNavigation,
    eintrag: NavBackStackEntry,
    galerieEintrag: NavBackStackEntry,
    setNumber: String,
    detail: @Composable () -> Unit,
) {
    val navController = navigation.navController
    // Die Liste links ist die Galerie selbst, darum ihr ViewModel; die Rollstelle teilt
    // sie mit dem Galerie-Ziel über den ScrollMemory.
    val galerie: GalerieViewModel = hiltViewModel(galerieEintrag)
    val galerieZustand by galerie.galleryState.collectAsStateWithLifecycle()
    val gridState = remember { LazyGridState() }
    ScrollPositionKeeper(SammlungZiel.Gallery.rollSchluessel, gridState, galerieZustand.sets.isNotEmpty(),
        navigation.rollgedaechtnis)
    // Die Erfassung der Galerie; den Scan gibt der Scanner diesem Ziel zurück.
    val erfassung: ErfassungViewModel = hiltViewModel(galerieEintrag)
    Erfassungsrahmen(eintrag, erfassung, navigation.bilder) { navController.navigate(SammlungZiel.SetDetail(it)) }
    navigation.Reiter(stringResource(R.string.nav_collection)) {
        ListeUndDetail(
            liste = {
                CompositionLocalProvider(LocalOffenesDetail provides setNumber) {
                    GalleryRoute(
                        vm = galerie,
                        erfassung = erfassung,
                        imageLoader = navigation.bilder,
                        onScanBarcode = { navController.navigate(SammlungZiel.BarcodeScanner(Scannerherkunft.GALERIE_SUCHE)) },
                        onSetClick = { sn ->
                            if (sn != setNumber) navController.navigate(SammlungZiel.SetDetail(sn)) {
                                popUpTo<SammlungZiel.SetDetail> { inclusive = true }
                            }
                        },
                        gridState = gridState,
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
    composable<SammlungZiel.Wanted> { eintrag ->
        val erfassung: ErfassungViewModel = hiltViewModel()
        Erfassungsrahmen(eintrag, erfassung, navigation.bilder) { navController.navigate(SammlungZiel.SetDetail(it)) }
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
                    onScan = { navController.navigate(SammlungZiel.BarcodeScanner(Scannerherkunft.MERKLISTE)) },
                    onOeffnenEinzeln = { sn, zustand ->
                        navController.navigate(SammlungZiel.MerkpostenDetail(sn, zustand))
                    },
                )
            }
        }
    }
    composable<SammlungZiel.MerkpostenDetail> { backStack ->
        val ziel = backStack.toRoute<SammlungZiel.MerkpostenDetail>()
        // Dasselbe ViewModel wie die Liste darunter: Dort läuft die Snackbar mit
        // „Rückgängig“, nachdem das Detail eines gelöschten Postens zurückgegangen ist.
        val liste = remember(backStack) { runCatching { navController.getBackStackEntry<SammlungZiel.Wanted>() }.getOrNull() }
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
    composable<SammlungZiel.BarcodeScanner> { eintrag ->
        val herkunft = eintrag.toRoute<SammlungZiel.BarcodeScanner>().herkunft
        // Der Treffer geht an das Ziel darunter; dessen Erfassung löst ihn auf.
        fun zurueck(wert: String, setnummer: Boolean) {
            navController.previousBackStackEntry?.savedStateHandle?.legeScanAb(wert, setnummer, herkunft)
            navController.popBackStack()
        }
        BarcodeScannerScreen(
            // Texterkennung nur hier: Dieser Scanner bedient „Set hinzufügen“ (Galerie) und
            // „Teileliste hinzufügen“. Der Preisvergleich hat einen eigenen Aufruf und lässt
            // den Standard aus.
            ocrEnabled = true,
            onResult = { scannedValue -> zurueck(scannedValue, setnummer = false) },
            // Die Texterkennung liefert die Setnummer fertig — der Umweg über die
            // EAN-Auflösung entfällt, das spart je Scan bis zu acht Rebrickable-Aufrufe.
            onSetNumberResult = { setNumber -> zurueck(setNumber, setnummer = true) },
            onDismiss = { navController.popBackStack() }
        )
    }
}

/** Schlüssel des Löschergebnisses, das das Set-Detail an die Galerie zurückgibt: Setnummer und Name. */
private const val LOESCHEN_VORMERKEN = "loeschenVormerken"
