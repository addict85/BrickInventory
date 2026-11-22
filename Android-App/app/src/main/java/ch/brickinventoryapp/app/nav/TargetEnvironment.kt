package ch.brickinventoryapp.app.nav

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import ch.brickinventoryapp.login.ui.LoginNavigation
import ch.brickinventoryapp.app.TabScaffold
import ch.brickinventoryapp.finances.ui.FinancesNavigation
import ch.brickinventoryapp.catalog.ui.CatalogNavigation
import ch.brickinventoryapp.account.ui.AccountNavigation
import ch.brickinventoryapp.account.ui.AccountTarget
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.collection.ui.CollectionNavigation
import ch.brickinventoryapp.collection.ui.setEntry
import ch.brickinventoryapp.collection.ui.partListsEntry
import ch.brickinventoryapp.parts.ui.PartsNavigation
import ch.brickinventoryapp.parts.ui.PartListsScan
import ch.brickinventoryapp.management.ui.ManagementNavigation
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.parts.ui.PartsTarget
import coil3.ImageLoader

/** A destination of the bottom bar: route, icon and label. */
data class Tab(val target: Any, val symbol: @Composable () -> Unit, val label: String)

/**
 * The environment of all areas: it fulfils every navigation interface and
 * connects the areas that do not know each other (catalog → adding and
 * wishlist item, parts list → scan). The few ViewModels of the activity come via
 * [activity], read only when shown — so the graph can be built without Hilt.
 */
class TargetEnvironment(
    override val navController: NavHostController,
    override val images: ImageLoader,
    val tab: List<Tab>,
    override val snackbar: SnackbarHostState,
    private val states: () -> ActivityState,
) : LoginNavigation, CollectionNavigation, CatalogNavigation, PartsNavigation, FinancesNavigation, AccountNavigation,
    ManagementNavigation {
    val activity: ActivityState get() = states()

    override val session get() = activity.app.state
    override val viewport get() = activity.app.viewport
    override val storage get() = activity.app.storageState
    override val scrollMemory get() = activity.app.scrollMemory
    override fun loadSettings() = activity.app.loadSettings()
    override fun logout() { activity.app.logout() }
    override val update: UpdateViewModel get() = activity.update
    override val appearance: AppearanceViewModel get() = activity.appearance
    override val trust: TrustViewModel get() = activity.trust

    @Composable
    override fun Tab(title: String, content: @Composable () -> Unit) = TabScaffold(title, this, content)

    @Composable
    override fun record(entry: NavBackStackEntry): (EntryRequest) -> Unit =
        setEntry(entry, images, ::openSet)

    @Composable
    override fun partListsScan(entry: NavBackStackEntry): PartListsScan =
        partListsEntry(entry, images, ::openSet, ::PartListsScan)

    // The paths between the areas: only here do the routes of foreign areas appear.

    override fun loggedIn() = navController.navigate(CollectionTarget.Gallery) {
        popUpTo<LoginTarget.Login> { inclusive = true }
    }

    override fun loggedOut() = navController.navigate(LoginTarget.Login) { popUpTo(0) { inclusive = true } }

    override fun openSetup() = navController.navigate(LoginTarget.Setup)

    override fun openSet(setNumber: String) = navController.navigate(CollectionTarget.SetDetail(setNumber))

    override fun openWantedItem(setNumber: String, condition: Condition) {
        navController.navigate(CollectionTarget.Wanted)
        navController.navigate(CollectionTarget.WantedItemDetail(setNumber, condition))
    }

    override fun openPurchases(kind: ItemKind, id: String, colorId: Int, title: String) =
        navController.navigate(CollectionTarget.AcquisitionManagement(kind, id, colorId, title))

    override fun openScanner(origin: ScannerOrigin) = navController.navigate(CollectionTarget.BarcodeScanner(origin))

    override fun openSinglePiece(kind: ItemKind, id: String, colorId: Int, title: String) =
        navController.navigate(PartsTarget.ManualItemDetail(kind, id, colorId, title))

    override fun openPdf(url: String, title: String) = showPdf(url, title)

    override fun openPriceAlerts() = navController.navigate(AccountTarget.PriceAlarms)
}
