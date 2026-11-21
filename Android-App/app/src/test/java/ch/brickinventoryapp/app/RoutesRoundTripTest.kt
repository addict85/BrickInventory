package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Round trip of every route with values through a real NavHost: what a destination
 * brings along, `toRoute()` reads back exactly so in the destination — also special characters
 * and the default “no color”. PDF addresses do not travel in the route (PdfSelection).
 *
 * Counter-check (gegenproben/route-feld-transient.patch, measurable only in CI):
 *   ManualItemDetail.title as @Transient → red “titles with special characters arrive unchanged“
 * Counter-check (gegenproben/postenart-aus-fest.patch, measurable only in CI):
 *   Postenart.aus() always returns SET → red “every item kind arrives as the same one“
 * Counter-check (measurable only in CI, not performed): StateSerializer with
 *   PrimitiveKind.STRING instead of SerialKind.ENUM → red “set numbers and wishlist items
 *   arrive unchanged” (navigation finds no NavType for the field)
 */
@RunWith(RobolectricTestRunner::class)
class RoutesRoundTripTest {

    @get:Rule
    val compose = createComposeRule()

    /** What the destination read on construction, per entry in the back stack. */
    private val gelesen = mutableMapOf<String, Any>()

    private lateinit var nav: NavHostController

    private fun aufbauen() {
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = LoginTarget.Setup) {
                composable<LoginTarget.Setup> {}
                composable<SammlungZiel.SetDetail> { gelesen[it.id] = it.toRoute<SammlungZiel.SetDetail>() }
                composable<KatalogZiel.CatalogDetail> { gelesen[it.id] = it.toRoute<KatalogZiel.CatalogDetail>() }
                composable<SammlungZiel.MerkpostenDetail> { gelesen[it.id] = it.toRoute<SammlungZiel.MerkpostenDetail>() }
                composable<TeileZiel.ManualItemDetail> { gelesen[it.id] = it.toRoute<TeileZiel.ManualItemDetail>() }
                composable<SammlungZiel.AcquisitionManagement> { gelesen[it.id] = it.toRoute<SammlungZiel.AcquisitionManagement>() }
                composable<FinanzZiel.PdfViewer> { gelesen[it.id] = it.toRoute<FinanzZiel.PdfViewer>() }
                composable<SammlungZiel.BarcodeScanner> { gelesen[it.id] = it.toRoute<SammlungZiel.BarcodeScanner>() }
            }
        }
        compose.waitForIdle()
    }

    /** Navigates to the destination and returns what the destination read. */
    private fun hin(ziel: Any): Any {
        compose.runOnIdle { nav.navigate(ziel) }
        compose.waitForIdle()
        return compose.runOnIdle {
            val oben = nav.currentBackStackEntry!!
            checkNotNull(gelesen[oben.id]) { "Ziel für $ziel nicht aufgebaut (${oben.destination.route})" }
        }
    }

    private val titel = listOf(
        "100 % C++",
        "Anthony / Skater",
        "Grüße aus Zürich: Öl, Ähre, ß",
        "a+b c",
        "Frage? #1 & mehr",
        "%20 steht hier wörtlich",
        "  Rand  ",
    )

    @Test
    fun `titles with special characters arrive unchanged`() {
        aufbauen()
        for (t in titel) {
            val teil = TeileZiel.ManualItemDetail(Postenart.PART, "3001 b", 4, t)
            assertEquals("Teil „$t“", teil, hin(teil))
            val kauf = SammlungZiel.AcquisitionManagement(Postenart.FIG, "sw0001+", 0, t)
            assertEquals("Kauf „$t“", kauf, hin(kauf))
        }
    }

    @Test
    fun `every item kind arrives as the same one`() {
        aufbauen()
        for (art in Postenart.entries) {
            val kauf = SammlungZiel.AcquisitionManagement(art, "3001", 4, "Stein")
            assertEquals(kauf, hin(kauf))
            assertEquals(art, Postenart.aus(art.kennung))
        }
    }

    @Test
    fun `the scanner knows where it was opened from`() {
        aufbauen()
        for (herkunft in Scannerherkunft.entries) {
            assertEquals(SammlungZiel.BarcodeScanner(herkunft), hin(SammlungZiel.BarcodeScanner(herkunft)))
        }
    }

    @Test
    fun `without a color no color arrives, not black`() {
        aufbauen()
        assertEquals(KEINE_FARBE, (hin(TeileZiel.ManualItemDetail(Postenart.FIG, "sw0001", title = "Luke")) as TeileZiel.ManualItemDetail).colorId)
    }

    @Test
    fun `the PDF viewer gets only its key`() {
        // Address (including ticket) and title stay in the PdfSelection (PdfSelectionTest).
        aufbauen()
        val pdf = FinanzZiel.PdfViewer("0f8e2c1a-7d3b-4c55-9a0e-1b2c3d4e5f60")
        assertEquals(pdf, hin(pdf))
    }

    @Test
    fun `set numbers and wishlist items arrive unchanged`() {
        aufbauen()
        for (sn in listOf("75192-1", "col23-1", "a b/c%", "10 % +1")) {
            assertEquals(SammlungZiel.SetDetail(sn), hin(SammlungZiel.SetDetail(sn)))
            assertEquals(KatalogZiel.CatalogDetail(sn), hin(KatalogZiel.CatalogDetail(sn)))
            assertEquals(SammlungZiel.MerkpostenDetail(sn, Zustand.GEBRAUCHT), hin(SammlungZiel.MerkpostenDetail(sn, Zustand.GEBRAUCHT)))
        }
    }
}
