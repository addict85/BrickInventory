package ch.brickinventoryapp.app.nav

import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.runtime.remember
import ch.brickinventoryapp.sammlung.ui.screens.MerkpostenRueckgaengigRoute
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
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
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import ch.brickinventoryapp.app.*
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.toRoute
import kotlinx.serialization.Serializable
import ch.brickinventoryapp.katalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.ui.listeUndDetail
import ch.brickinventoryapp.sammlung.ui.screens.MerklisteRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerkpostenDetailRoute

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
                val erfassung = u.aktivitaet.erfassung
                val merkliste = hiltViewModel<MerklisteViewModel>()
                MerkpostenRueckgaengigRoute(merkliste, u.snackbarHostState)
                MerklisteRoute(
                    vm = merkliste,
                    imageLoader = imageLoader,
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
            val vm = u.aktivitaet.app
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
        composable<Screen.CatalogDetail> { backStack -> KatalogDetailZiel(u, backStack) }
    }
}

/** Das Katalog-Detail; eigene Funktion, damit katalogZiele kurz bleibt. */
@Composable
private fun KatalogDetailZiel(u: ZielUmgebung, backStack: NavBackStackEntry) {
    val navController = u.navController
    val imageLoader = u.imageLoader
    val vm = u.aktivitaet.app
    val katalog = katalogViewModel(navController, backStack)
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val catSetNumber = backStack.toRoute<Screen.CatalogDetail>().setNumber
    val merkliste: MerklisteViewModel = hiltViewModel()
    val erfassung = u.aktivitaet.erfassung
    val catalogState by katalog.state.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    // Steht das Set schon auf der Merkliste? Dann zeigt das Detail den Posten statt „Auf die Merkliste“.
    val merkposten by merkliste.merklisteState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { merkliste.ladeMerkliste() }
    // loadCatalogDetail() meldet über denselben Kanal wie alle ViewModels
    // (data/MeldungsKanal.kt), eingesammelt in AppNavigation.kt.
    CatalogDetailScreen(
        setNumber = catSetNumber,
        detail = catalogState.detail?.takeIf { it.setNumber == catSetNumber },
        isLoading = catalogState.detailLoading,
        imageLoader = imageLoader,
        serverUrl = state.serverUrl,
        defaultCondition = state.userDefaultCondition ?: Zustand.NEU,
        onLoad = katalog::loadCatalogDetail,
        householdMembers = blick.householdMembers,
        // Der VORRAT an Lagerorten, nicht die belegten Orte: Beim
        // Erfassen soll auch ein leeres Regal zur Wahl stehen.
        lagerorte = lagerZustand.eigene.map { it.name },
        lagerortVorgabe = lagerZustand.vorgabe?.name ?: "",
        onAddToGallery = { wunsch ->
            // Das Aufnehmen gehört der Galerie, das „besitze ich“ dem Katalog — die
            // Abhängigkeit steht hier sichtbar statt versteckt in einer gemeinsamen
            // Funktion.
            erfassung.addSet(wunsch)
            katalog.markiereAufgenommen(wunsch.setNumber, wunsch.menge)
        },
        // Merkposten UND Preisalarm in einem Griff — die Regel dahinter
        // steht im MerklisteViewModel, nicht hier.
        onWish = { sn, zustand, richtung, schwelle, konto ->
            merkliste.merkpostenMitAlarm(sn, zustand, richtung, schwelle, konto)
        },
        onOpenInGallery = { sn -> navController.navigate(Screen.SetDetail(sn)) },
        onBack = { navController.popBackStack() },
        gemerkt = merkposten.merkposten.firstOrNull { it.setNumber == catSetNumber },
        // Über die Liste: Dort läuft die Snackbar, wenn der Posten gelöscht wird.
        onOeffneMerkposten = { sn, zustand ->
            navController.navigate(Screen.Wanted)
            navController.navigate(Screen.MerkpostenDetail(sn, zustand))
        },
    )
}

/** Das ViewModel des Teilgraphen, an dessen Eintrag gebunden. */
@Composable
private fun katalogViewModel(navController: NavHostController, eintrag: NavBackStackEntry): CatalogViewModel {
    val bereich = remember(eintrag) { navController.getBackStackEntry<KatalogBereich>() }
    return hiltViewModel(bereich)
}
