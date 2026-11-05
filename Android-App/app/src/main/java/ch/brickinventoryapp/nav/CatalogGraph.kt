package ch.brickinventoryapp.nav

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import ch.brickinventoryapp.*
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.toRoute
import kotlinx.serialization.Serializable
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.ui.listeUndDetail
import ch.brickinventoryapp.ui.screens.MerklisteRoute
import ch.brickinventoryapp.ui.screens.MerkpostenDetailRoute
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel

/**
 * Liste und Detail des Katalogs als eigener Teilgraph: Beide holen ihr ViewModel
 * an dessen Eintrag, so sieht die Liste das „besitze ich“ aus dem Detail, und das
 * ViewModel endet mit dem Katalog statt mit der Activity.
 */
@Serializable
internal data object KatalogBereich

/** Navigationsziele von Katalog und Merkliste. */
fun NavGraphBuilder.catalogGraph(u: ZielUmgebung) {
    merklisteZiele(u)
    katalogZiele(u)
}

/**
 * Die Merkliste steht hier und nicht im CollectionGraph: Sie ist kein Bestand. Der
 * häufigste Weg hinein kommt aus dem Katalog, und wie er zeigt sie Sets, die einem
 * nicht gehören.
 */
private fun NavGraphBuilder.merklisteZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    composable<Screen.Wanted> {
        // Auf breiten Fenstern Liste und Detail nebeneinander (Lesebreite.kt).
        androidx.compose.foundation.layout.BoxWithConstraints {
            val nebeneinander = listeUndDetail(maxWidth.value)
            ReiterGeruest(stringResource(R.string.nav_wanted), u) {
                val erfassung = aktivitaetsViewModel<ErfassungViewModel>()
                MerklisteRoute(
                    vm = hiltViewModel<MerklisteViewModel>(),
                    imageLoader = imageLoader,
                    nebeneinander = nebeneinander,
                    onScan = { erfassung.setScannerSource("wanted"); navController.navigate(Screen.BarcodeScanner) },
                    onOeffnenEinzeln = { sn, zustand ->
                        navController.navigate(Screen.MerkpostenDetail(sn, zustand))
                    },
                )
            }
        }
    }
    composable<Screen.MerkpostenDetail> { backStack ->
        val ziel = backStack.toRoute<Screen.MerkpostenDetail>()
        MerkpostenDetailRoute(
            vm = hiltViewModel<MerklisteViewModel>(),
            setNumber = ziel.setNumber,
            condition = ziel.condition,
            imageLoader = imageLoader,
            onBack = { navController.popBackStack() },
        )
    }
}

/** Liste und Detail des Katalogs im eigenen Teilgraphen ([KatalogBereich]). */
private fun NavGraphBuilder.katalogZiele(u: ZielUmgebung) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    navigation<KatalogBereich>(startDestination = Screen.Catalog) {
        composable<Screen.Catalog> { eintrag ->
            val vm: AppViewModel = aktivitaetsViewModel()
            val katalog = katalogViewModel(navController, eintrag)
            val state by vm.state.collectAsStateWithLifecycle()
            val catalogState by katalog.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank() && catalogState.loadedPages.isEmpty() && !catalogState.isLoading) {
                    katalog.loadCatalogMeta(); katalog.loadCatalogSets()
                }
            }
            ReiterGeruest(stringResource(R.string.nav_catalog), u) {
                CatalogRoute(
                    katalog = katalog,
                    serverUrl = state.serverUrl,
                    imageLoader = imageLoader,
                    onSetClick = { navController.navigate(Screen.CatalogDetail(it)) },
                )
            }
        }
        composable<Screen.CatalogDetail> { backStack ->
            val vm: AppViewModel = aktivitaetsViewModel()
            val katalog = katalogViewModel(navController, backStack)
            val state by vm.state.collectAsStateWithLifecycle()
            val blick by vm.blickfeld.collectAsStateWithLifecycle()
            val catSetNumber = backStack.toRoute<Screen.CatalogDetail>().setNumber
            val merkliste: MerklisteViewModel = hiltViewModel()
            val erfassung = aktivitaetsViewModel<ErfassungViewModel>()
            val catalogState by katalog.state.collectAsStateWithLifecycle()
            val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
            // loadCatalogDetail() meldet über denselben Kanal wie alle ViewModels
            // (data/MeldungsKanal.kt), eingesammelt in AppNavigation.kt.
            CatalogDetailScreen(
                setNumber = catSetNumber,
                detail = catalogState.detail?.takeIf { it.setNumber == catSetNumber },
                isLoading = catalogState.detailLoading,
                imageLoader = imageLoader,
                serverUrl = state.serverUrl,
                defaultCondition = state.userDefaultCondition ?: "N",
                onLoad = katalog::loadCatalogDetail,
                householdMembers = blick.householdMembers,
                // Der VORRAT an Lagerorten, nicht die belegten Orte: Beim
                // Erfassen soll auch ein leeres Regal zur Wahl stehen.
                lagerorte = lagerZustand.eigene.map { it.name },
                lagerortVorgabe = lagerZustand.vorgabe?.name ?: "",
                onAddToGallery = { sn, qty, price, cond, owner, ort ->
                    // Das Aufnehmen gehört der Galerie, das „besitze ich“ dem Katalog — die
                    // Abhängigkeit steht hier sichtbar statt versteckt in einer gemeinsamen
                    // Funktion.
                    erfassung.addSet(sn, qty, price, cond, owner, ort)
                    katalog.markiereAufgenommen(sn, qty)
                },
                // Merkposten UND Preisalarm in einem Griff — die Regel dahinter
                // steht im MerklisteViewModel, nicht hier.
                onWish = { sn, zustand, richtung, schwelle, konto ->
                    merkliste.merkpostenMitAlarm(sn, zustand, richtung, schwelle, konto)
                },
                onOpenInGallery = { sn -> navController.navigate(Screen.SetDetail(sn)) },
                onBack = { navController.popBackStack() }
            )
        }
    }
}

/** Das ViewModel des Teilgraphen, an dessen Eintrag gebunden. */
@Composable
private fun katalogViewModel(navController: NavHostController, eintrag: NavBackStackEntry): CatalogViewModel {
    val bereich = remember(eintrag) { navController.getBackStackEntry<KatalogBereich>() }
    return hiltViewModel(bereich)
}
