package ch.brickinventoryapp.catalog.ui

import androidx.compose.runtime.Composable
import ch.brickinventoryapp.model.ui.Load
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
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.navigation.AreaEnvironment

/**
 * What the catalog needs from other areas: entering belongs to the gallery, the
 * destinations to the collection's watchlist. The CatalogViewModel reads and creates the
 * watchlist item itself via the cache; a watchlist ViewModel doesn't need it for that.
 */
interface CatalogNavigation : AreaEnvironment {
    /** Add a set to the gallery; entering hangs on [entry], its check display above it. */
    @Composable
    fun record(entry: NavBackStackEntry): (EntryRequest) -> Unit

    /** The set in the gallery. */
    fun openSet(setNumber: String)

    /** The watchlist item above the watchlist: the snackbar runs there when it's deleted. */
    fun openWantedItem(setNumber: String, condition: Condition)
}

/** The catalog's destinations. */
fun NavGraphBuilder.catalogGraph(navigation: CatalogNavigation) {
    val navController = navigation.navController
    navigation<CatalogTarget.Area>(startDestination = CatalogTarget.Catalog) {
        composable<CatalogTarget.Catalog> { entry ->
            val catalog = catalogViewModel(navController, entry)
            val state by navigation.session.collectAsStateWithLifecycle()
            navigation.Tab(stringResource(R.string.nav_catalog)) {
                CatalogRoute(
                    catalog = catalog,
                    serverUrl = state.serverUrl,
                    imageLoader = navigation.images,
                    scrollMemory = navigation.scrollMemory,
                    onSetClick = { navController.navigate(CatalogTarget.CatalogDetail(it)) },
                )
            }
        }
        composable<CatalogTarget.CatalogDetail> { backStack -> CatalogDetailTarget(navigation, backStack) }
    }
}

/** The catalog detail; its own function, so the graph stays short. */
@Composable
private fun CatalogDetailTarget(navigation: CatalogNavigation, backStack: NavBackStackEntry) {
    val navController = navigation.navController
    val catalog = catalogViewModel(navController, backStack)
    val state by navigation.session.collectAsStateWithLifecycle()
    val glance by navigation.viewport.collectAsStateWithLifecycle()
    val catSetNumber = backStack.toRoute<CatalogTarget.CatalogDetail>().setNumber
    val catalogState by catalog.state.collectAsStateWithLifecycle()
    val storageUiState by navigation.storage.collectAsStateWithLifecycle()
    // Is the set already on the watchlist? Then the detail shows the item instead of "Add to watchlist".
    val wanted by remember(catalog, catSetNumber) { catalog.wanted(catSetNumber) }.collectAsStateWithLifecycle(null)
    val record = navigation.record(backStack)
    // loadCatalogDetail() reports over the same channel as every ViewModel
    // (data/MessageChannel.kt), collected in AppNavigation.kt.
    CatalogDetailScreen(
        setNumber = catSetNumber,
        // Don't show the last-opened one until this set's detail is there.
        loaded = catalogState.detail.let { if (it is Load.Data && it.value.setNumber != catSetNumber) Load.Loads else it },
        imageLoader = navigation.images,
        serverUrl = state.serverUrl,
        defaultCondition = state.userDefaultCondition ?: Condition.NEW,
        onLoad = catalog::loadCatalogDetail,
        householdMembers = glance.householdMembers,
        // The STOCK of storage locations, not the occupied ones: an empty
        // shelf should also be selectable when entering.
        storageLocations = storageUiState.own.map { it.name },
        locationDefault = storageUiState.default?.name ?: "",
        onAddToGallery = { wish ->
            record(wish)
            catalog.markCaptured(wish.setNumber, wish.quantity)
        },
        onWish = catalog::track,
        onOpenInGallery = navigation::openSet,
        onBack = { navController.popBackStack() },
        wanted = wanted,
        onOpenWantedItem = navigation::openWantedItem,
    )
}

/** The sub-graph's ViewModel, tied to its entry. */
@Composable
private fun catalogViewModel(navController: NavHostController, entry: NavBackStackEntry): CatalogViewModel {
    val area = remember(entry) { navController.getBackStackEntry<CatalogTarget.Area>() }
    return hiltViewModel(area)
}
