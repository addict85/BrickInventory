package ch.brickinventoryapp.app.nav

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import ch.brickinventoryapp.login.ui.LoginNavigation
import ch.brickinventoryapp.app.ReiterGeruest
import ch.brickinventoryapp.finances.ui.FinancesNavigation
import ch.brickinventoryapp.catalog.ui.CatalogNavigation
import ch.brickinventoryapp.account.ui.AccountNavigation
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.collection.ui.CollectionNavigation
import ch.brickinventoryapp.collection.ui.setEntry
import ch.brickinventoryapp.collection.ui.partListsEntry
import ch.brickinventoryapp.parts.ui.PartsNavigation
import ch.brickinventoryapp.parts.ui.PartListsScan
import ch.brickinventoryapp.management.ui.ManagementNavigation
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.state.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel
import coil3.ImageLoader

/** Ein Ziel der unteren Leiste: Route, Symbol und Beschriftung. */
data class Reiter(val ziel: Any, val symbol: @Composable () -> Unit, val beschriftung: String)

/**
 * Die Umgebung aller Bereiche: Sie erfüllt jede Navigationsschnittstelle und
 * verbindet die Bereiche, die einander nicht kennen (Katalog → Erfassung und
 * Merkposten, Teileliste → Scan). Die wenigen ViewModels der Activity kommen über
 * [aktivitaet], erst beim Zeigen gelesen — so lässt sich der Graph ohne Hilt bauen.
 */
class TargetEnvironment(
    override val navController: NavHostController,
    override val bilder: ImageLoader,
    val tab: List<Reiter>,
    override val snackbar: SnackbarHostState,
    private val states: () -> ActivityState,
) : LoginNavigation, CollectionNavigation, CatalogNavigation, PartsNavigation, FinancesNavigation, AccountNavigation,
    ManagementNavigation {
    val aktivitaet: ActivityState get() = states()

    override val sitzung get() = aktivitaet.app.state
    override val blickfeld get() = aktivitaet.app.blickfeld
    override val lager get() = aktivitaet.app.storageState
    override val rollgedaechtnis get() = aktivitaet.app.scrollMemory
    override fun ladeEinstellungen() = aktivitaet.app.loadSettings()
    override fun abmelden() { aktivitaet.app.logout() }
    override val update: UpdateViewModel get() = aktivitaet.update
    override val darstellung: DarstellungViewModel get() = aktivitaet.darstellung
    override val vertrauen: VertrauenViewModel get() = aktivitaet.vertrauen

    @Composable
    override fun Reiter(titel: String, inhalt: @Composable () -> Unit) = ReiterGeruest(titel, this, inhalt)

    @Composable
    override fun erfassen(entry: NavBackStackEntry): (Erfassungswunsch) -> Unit =
        setEntry(entry, bilder, ::openSet)

    @Composable
    override fun partListsScan(entry: NavBackStackEntry): PartListsScan =
        partListsEntry(entry, bilder, ::openSet, ::PartListsScan)

    // Die Wege zwischen den Bereichen: Nur hier stehen die Routen fremder Bereiche.

    override fun angemeldet() = navController.navigate(SammlungZiel.Gallery) {
        popUpTo<LoginTarget.Login> { inclusive = true }
    }

    override fun abgemeldet() = navController.navigate(LoginTarget.Login) { popUpTo(0) { inclusive = true } }

    override fun openSetup() = navController.navigate(LoginTarget.Setup)

    override fun openSet(setNumber: String) = navController.navigate(SammlungZiel.SetDetail(setNumber))

    override fun openWantedItem(setNumber: String, zustand: Zustand) {
        navController.navigate(SammlungZiel.Wanted)
        navController.navigate(SammlungZiel.MerkpostenDetail(setNumber, zustand))
    }

    override fun openPurchases(art: Postenart, id: String, colorId: Int, titel: String) =
        navController.navigate(SammlungZiel.AcquisitionManagement(art, id, colorId, titel))

    override fun openScanner(herkunft: Scannerherkunft) = navController.navigate(SammlungZiel.BarcodeScanner(herkunft))

    override fun openSinglePiece(art: Postenart, id: String, colorId: Int, titel: String) =
        navController.navigate(TeileZiel.ManualItemDetail(art, id, colorId, titel))

    override fun openPdf(url: String, titel: String) = showPdf(url, titel)
}
