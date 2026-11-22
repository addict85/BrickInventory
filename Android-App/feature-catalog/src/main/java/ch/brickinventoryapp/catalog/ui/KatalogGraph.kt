package ch.brickinventoryapp.catalog.ui

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
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.catalog.ui.screens.CatalogRoute
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.navigation.Bereichsumgebung

/**
 * What the catalog needs from other areas: entering belongs to the gallery, the
 * destinations to the collection's watchlist. The CatalogViewModel reads and creates the
 * watchlist item itself via the cache; a watchlist ViewModel doesn't need it for that.
 */
interface CatalogNavigation : Bereichsumgebung {
    /** Add a set to the gallery; entering hangs on [entry], its check display above it. */
    @Composable
    fun erfassen(entry: NavBackStackEntry): (Erfassungswunsch) -> Unit

    /** The set in the gallery. */
    fun openSet(setNumber: String)

    /** The watchlist item above the watchlist: the snackbar runs there when it's deleted. */
    fun openWantedItem(setNumber: String, zustand: Zustand)
}

/** The catalog's destinations. */
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

/** The catalog detail; its own function, so the graph stays short. */
@Composable
private fun CatalogDetailTarget(navigation: CatalogNavigation, backStack: NavBackStackEntry) {
    val navController = navigation.navController
    val katalog = catalogViewModel(navController, backStack)
    val state by navigation.sitzung.collectAsStateWithLifecycle()
    val blick by navigation.blickfeld.collectAsStateWithLifecycle()
    val catSetNumber = backStack.toRoute<KatalogZiel.CatalogDetail>().setNumber
    val catalogState by katalog.state.collectAsStateWithLifecycle()
    val lagerZustand by navigation.lager.collectAsStateWithLifecycle()
    // Is the set already on the watchlist? Then the detail shows the item instead of "Add to watchlist".
    val gemerkt by remember(katalog, catSetNumber) { katalog.gemerkt(catSetNumber) }.collectAsStateWithLifecycle(null)
    val record = navigation.erfassen(backStack)
    // loadCatalogDetail() reports over the same channel as every ViewModel
    // (data/MeldungsKanal.kt), collected in AppNavigation.kt.
    CatalogDetailScreen(
        setNumber = catSetNumber,
        // Don't show the last-opened one until this set's detail is there.
        geladen = catalogState.detail.let { if (it is Laden.Daten && it.wert.setNumber != catSetNumber) Laden.Loads else it },
        imageLoader = navigation.bilder,
        serverUrl = state.serverUrl,
        defaultCondition = state.userDefaultCondition ?: Zustand.NEU,
        onLoad = katalog::loadCatalogDetail,
        householdMembers = blick.householdMembers,
        // The STOCK of storage locations, not the occupied ones: an empty
        // shelf should also be selectable when entering.
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

/** The sub-graph's ViewModel, tied to its entry. */
@Composable
private fun catalogViewModel(navController: NavHostController, entry: NavBackStackEntry): CatalogViewModel {
    val bereich = remember(entry) { navController.getBackStackEntry<KatalogZiel.Bereich>() }
    return hiltViewModel(bereich)
}
