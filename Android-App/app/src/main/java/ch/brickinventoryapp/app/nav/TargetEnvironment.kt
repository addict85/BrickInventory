package ch.brickinventoryapp.app.nav

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import ch.brickinventoryapp.anmeldung.ui.LoginNavigation
import ch.brickinventoryapp.app.ReiterGeruest
import ch.brickinventoryapp.finanzen.ui.FinancesNavigation
import ch.brickinventoryapp.katalog.ui.CatalogNavigation
import ch.brickinventoryapp.konto.ui.AccountNavigation
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.sammlung.ui.CollectionNavigation
import ch.brickinventoryapp.sammlung.ui.setEntry
import ch.brickinventoryapp.sammlung.ui.partListsEntry
import ch.brickinventoryapp.teile.ui.PartsNavigation
import ch.brickinventoryapp.teile.ui.PartListsScan
import ch.brickinventoryapp.verwaltung.ui.ManagementNavigation
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.anmeldung.ui.LoginTarget
import ch.brickinventoryapp.sammlung.ui.SammlungZiel
import ch.brickinventoryapp.teile.ui.TeileZiel
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
