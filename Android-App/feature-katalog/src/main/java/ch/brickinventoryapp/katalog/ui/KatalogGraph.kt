package ch.brickinventoryapp.katalog.ui

import androidx.compose.runtime.Composable
import ch.brickinventoryapp.model.ui.Laden
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.navigation.Bereichsumgebung

/**
 * Was der Katalog von anderen Bereichen braucht: Erfassen gehört der Galerie, die
 * Ziele der Merkliste der Sammlung. Den Merkposten selbst liest und legt das
 * CatalogViewModel über die Ablage an; ein ViewModel der Merkliste braucht es dafür nicht.
 */
interface CatalogNavigation : Bereichsumgebung {
    /** Ein Set in die Galerie aufnehmen; die Erfassung hängt an [entry], ihre Prüfanzeige darüber. */
    @Composable
    fun erfassen(entry: NavBackStackEntry): (Erfassungswunsch) -> Unit

    /** Das Set in der Galerie. */
    fun openSet(setNumber: String)

    /** Der Merkposten über der Merkliste: Dort läuft die Snackbar, wenn er gelöscht wird. */
    fun openWantedItem(setNumber: String, zustand: Zustand)
}

/** Die Ziele des Katalogs. */
fun NavGraphBuilder.catalogGraph(navigation: CatalogNavigation) {
    val navController = navigation.navController
    navigation<KatalogZiel.Bereich>(startDestination = KatalogZiel.Catalog) {
        composable<KatalogZiel.Catalog> { entry ->
            val katalog = catalogViewModel(navController, entry)
            val state by navigation.sitzung.collectAsStateWithLifecycle()
            navigation.Reiter(stringResource(R.string.nav_catalog)) {
                CatalogRoute(
                    katalog = katalog,
                    serverUrl = state.serverUrl,
                    imageLoader = navigation.bilder,
                    rollgedaechtnis = navigation.rollgedaechtnis,
                    onSetClick = { navController.navigate(KatalogZiel.CatalogDetail(it)) },
                )
            }
        }
        composable<KatalogZiel.CatalogDetail> { backStack -> CatalogDetailTarget(navigation, backStack) }
    }
}

/** Das Katalog-Detail; eigene Funktion, damit der Graph kurz bleibt. */
@Composable
private fun CatalogDetailTarget(navigation: CatalogNavigation, backStack: NavBackStackEntry) {
    val navController = navigation.navController
    val katalog = catalogViewModel(navController, backStack)
    val state by navigation.sitzung.collectAsStateWithLifecycle()
    val blick by navigation.blickfeld.collectAsStateWithLifecycle()
    val catSetNumber = backStack.toRoute<KatalogZiel.CatalogDetail>().setNumber
    val catalogState by katalog.state.collectAsStateWithLifecycle()
    val lagerZustand by navigation.lager.collectAsStateWithLifecycle()
    // Steht das Set schon auf der Merkliste? Dann zeigt das Detail den Posten statt „Auf die Merkliste“.
    val gemerkt by remember(katalog, catSetNumber) { katalog.gemerkt(catSetNumber) }.collectAsStateWithLifecycle(null)
    val record = navigation.erfassen(backStack)
    // loadCatalogDetail() meldet über denselben Kanal wie alle ViewModels
    // (data/MeldungsKanal.kt), eingesammelt in AppNavigation.kt.
    CatalogDetailScreen(
        setNumber = catSetNumber,
        // Bis das Detail dieses Sets da ist, nicht das zuletzt geöffnete zeigen.
        geladen = catalogState.detail.let { if (it is Laden.Daten && it.wert.setNumber != catSetNumber) Laden.Loads else it },
        imageLoader = navigation.bilder,
        serverUrl = state.serverUrl,
        defaultCondition = state.userDefaultCondition ?: Zustand.NEU,
        onLoad = katalog::loadCatalogDetail,
        householdMembers = blick.householdMembers,
        // Der VORRAT an Lagerorten, nicht die belegten Orte: Beim
        // Erfassen soll auch ein leeres Regal zur Wahl stehen.
        lagerorte = lagerZustand.eigene.map { it.name },
        locationDefault = lagerZustand.vorgabe?.name ?: "",
        onAddToGallery = { wish ->
            record(wish)
            katalog.markCaptured(wish.setNumber, wish.menge)
        },
        onWish = katalog::merke,
        onOpenInGallery = navigation::openSet,
        onBack = { navController.popBackStack() },
        gemerkt = gemerkt,
        onOpenWantedItem = navigation::openWantedItem,
    )
}

/** Das ViewModel des Teilgraphen, an dessen Eintrag gebunden. */
@Composable
private fun catalogViewModel(navController: NavHostController, entry: NavBackStackEntry): CatalogViewModel {
    val bereich = remember(entry) { navController.getBackStackEntry<KatalogZiel.Bereich>() }
    return hiltViewModel(bereich)
}
