package ch.brickinventoryapp.katalog.ui

import ch.brickinventoryapp.model.fach.Alarmrichtung
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import androidx.navigation.toRoute
import ch.brickinventoryapp.katalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.katalog.ui.screens.CatalogRoute
import ch.brickinventoryapp.katalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.Bereichsumgebung

/**
 * Was der Katalog von anderen Bereichen braucht: Erfassen gehört der Galerie, die
 * Merkliste der Sammlung. Die App reicht beides herein, der Katalog kennt keinen
 * der beiden Bereiche.
 */
interface KatalogNavigation : Bereichsumgebung {
    /** Ein Set in die Galerie aufnehmen; die Erfassung hängt an [eintrag], ihre Prüfanzeige darüber. */
    @Composable
    fun erfassen(eintrag: NavBackStackEntry): (Erfassungswunsch) -> Unit

    /** Der Merkposten zu [setNumber], wenn das Set auf der Merkliste steht. */
    @Composable
    fun gemerkt(setNumber: String): MerkpostenAnsicht?

    /** Merkposten und Preisalarm in einem Griff; die Regel dahinter gehört der Merkliste. */
    @Composable
    fun merken(): (setNumber: String, zustand: Zustand, richtung: Alarmrichtung, schwelleRoh: String, konto: Int?) -> Unit

    /** Das Set in der Galerie. */
    fun oeffneSet(setNumber: String)

    /** Der Merkposten über der Merkliste: Dort läuft die Snackbar, wenn er gelöscht wird. */
    fun oeffneMerkposten(setNumber: String, zustand: Zustand)
}

/** Die Ziele des Katalogs. */
fun NavGraphBuilder.katalogGraph(navigation: KatalogNavigation) {
    val navController = navigation.navController
    navigation<KatalogZiel.Bereich>(startDestination = KatalogZiel.Catalog) {
        composable<KatalogZiel.Catalog> { eintrag ->
            val vm = navigation.app
            val katalog = katalogViewModel(navController, eintrag)
            val state by vm.state.collectAsStateWithLifecycle()
            val catalogState by katalog.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank() && catalogState.loadedPages.isEmpty() && !catalogState.isLoading) {
                    katalog.loadCatalogMeta(); katalog.loadCatalogSets()
                }
            }
            navigation.Reiter(stringResource(R.string.nav_catalog)) {
                CatalogRoute(
                    katalog = katalog,
                    serverUrl = state.serverUrl,
                    imageLoader = navigation.bilder,
                    onSetClick = { navController.navigate(KatalogZiel.CatalogDetail(it)) },
                )
            }
        }
        composable<KatalogZiel.CatalogDetail> { backStack -> KatalogDetailZiel(navigation, backStack) }
    }
}

/** Das Katalog-Detail; eigene Funktion, damit der Graph kurz bleibt. */
@Composable
private fun KatalogDetailZiel(navigation: KatalogNavigation, backStack: NavBackStackEntry) {
    val navController = navigation.navController
    val vm = navigation.app
    val katalog = katalogViewModel(navController, backStack)
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val catSetNumber = backStack.toRoute<KatalogZiel.CatalogDetail>().setNumber
    val catalogState by katalog.state.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    // Steht das Set schon auf der Merkliste? Dann zeigt das Detail den Posten statt „Auf die Merkliste“.
    val gemerkt = navigation.gemerkt(catSetNumber)
    val merken = navigation.merken()
    val erfasse = navigation.erfassen(backStack)
    // loadCatalogDetail() meldet über denselben Kanal wie alle ViewModels
    // (data/MeldungsKanal.kt), eingesammelt in AppNavigation.kt.
    CatalogDetailScreen(
        setNumber = catSetNumber,
        detail = catalogState.detail?.takeIf { it.setNumber == catSetNumber },
        isLoading = catalogState.detailLoading,
        imageLoader = navigation.bilder,
        serverUrl = state.serverUrl,
        defaultCondition = state.userDefaultCondition ?: Zustand.NEU,
        onLoad = katalog::loadCatalogDetail,
        householdMembers = blick.householdMembers,
        // Der VORRAT an Lagerorten, nicht die belegten Orte: Beim
        // Erfassen soll auch ein leeres Regal zur Wahl stehen.
        lagerorte = lagerZustand.eigene.map { it.name },
        lagerortVorgabe = lagerZustand.vorgabe?.name ?: "",
        onAddToGallery = { wunsch ->
            erfasse(wunsch)
            katalog.markiereAufgenommen(wunsch.setNumber, wunsch.menge)
        },
        onWish = merken,
        onOpenInGallery = navigation::oeffneSet,
        onBack = { navController.popBackStack() },
        gemerkt = gemerkt,
        onOeffneMerkposten = navigation::oeffneMerkposten,
    )
}

/** Das ViewModel des Teilgraphen, an dessen Eintrag gebunden. */
@Composable
private fun katalogViewModel(navController: NavHostController, eintrag: NavBackStackEntry): CatalogViewModel {
    val bereich = remember(eintrag) { navController.getBackStackEntry<KatalogZiel.Bereich>() }
    return hiltViewModel(bereich)
}
