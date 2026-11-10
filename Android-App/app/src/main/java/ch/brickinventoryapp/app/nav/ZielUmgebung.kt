package ch.brickinventoryapp.app.nav

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import ch.brickinventoryapp.app.ReiterGeruest
import ch.brickinventoryapp.finanzen.ui.FinanzenNavigation
import ch.brickinventoryapp.katalog.ui.KatalogNavigation
import ch.brickinventoryapp.konto.ui.KontoNavigation
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.sammlung.ui.SammlungNavigation
import ch.brickinventoryapp.sammlung.ui.gemerkterPosten
import ch.brickinventoryapp.sammlung.ui.merkpostenMitAlarm
import ch.brickinventoryapp.sammlung.ui.setErfassung
import ch.brickinventoryapp.sammlung.ui.teilelistenErfassung
import ch.brickinventoryapp.teile.ui.TeileNavigation
import ch.brickinventoryapp.teile.ui.TeilelistenScan
import ch.brickinventoryapp.verwaltung.ui.VerwaltungNavigation
import ch.brickinventoryapp.zustand.ui.AppViewModel
import ch.brickinventoryapp.zustand.ui.Rollzustaende
import ch.brickinventoryapp.zustand.ui.Screen
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel
import coil3.ImageLoader

/** Ein Ziel der unteren Leiste: Route, Symbol und Beschriftung. */
data class Reiter(val ziel: Screen, val symbol: @Composable () -> Unit, val beschriftung: String)

/**
 * Die Umgebung aller Bereiche: Sie erfüllt jede Navigationsschnittstelle und
 * verbindet die Bereiche, die einander nicht kennen (Katalog → Erfassung und
 * Merkliste, Teileliste → Scan). Die wenigen ViewModels der Activity kommen über
 * [aktivitaet], erst beim Zeigen gelesen — so lässt sich der Graph ohne Hilt bauen.
 */
class ZielUmgebung(
    override val navController: NavHostController,
    override val bilder: ImageLoader,
    val reiter: List<Reiter>,
    override val snackbar: SnackbarHostState,
    override val rollen: Rollzustaende,
    private val zustaende: () -> AktivitaetsZustand,
) : SammlungNavigation, KatalogNavigation, TeileNavigation, FinanzenNavigation, KontoNavigation, VerwaltungNavigation {
    val aktivitaet: AktivitaetsZustand get() = zustaende()

    override val app: AppViewModel get() = aktivitaet.app
    override val update: UpdateViewModel get() = aktivitaet.update
    override val darstellung: DarstellungViewModel get() = aktivitaet.darstellung
    override val vertrauen: VertrauenViewModel get() = aktivitaet.vertrauen

    @Composable
    override fun Reiter(titel: String, inhalt: @Composable () -> Unit) = ReiterGeruest(titel, this, inhalt)

    @Composable
    override fun erfassen(eintrag: NavBackStackEntry): (Erfassungswunsch) -> Unit =
        setErfassung(eintrag, bilder) { navController.navigate(Screen.SetDetail(it)) }

    @Composable
    override fun gemerkt(setNumber: String): MerkpostenAnsicht? = gemerkterPosten(setNumber)

    @Composable
    override fun merken(): (String, Zustand, String, String, Int?) -> Unit = merkpostenMitAlarm()

    @Composable
    override fun teilelistenScan(eintrag: NavBackStackEntry): TeilelistenScan =
        teilelistenErfassung(eintrag, bilder, { navController.navigate(Screen.SetDetail(it)) }, ::TeilelistenScan)
}
