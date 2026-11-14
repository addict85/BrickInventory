package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.anmeldung.ui.AnmeldeZiel
import ch.brickinventoryapp.finanzen.ui.FinanzZiel
import ch.brickinventoryapp.katalog.ui.KatalogZiel
import ch.brickinventoryapp.sammlung.ui.SammlungZiel
import ch.brickinventoryapp.teile.ui.TeileZiel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Hin- und Rückweg jeder Route mit Werten durch einen echten NavHost: Was ein Ziel
 * mitbringt, liest `toRoute()` im Ziel genau so zurück — auch Sonderzeichen
 * und die Vorgabe „keine Farbe“. PDF-Adressen reisen nicht in der Route (PdfAuswahl).
 *
 * Gegenprobe (gegenproben/route-feld-transient.patch, nur in der CI messbar):
 *   ManualItemDetail.title als @Transient → rot „Titel mit Sonderzeichen kommen unverändert an“
 * Gegenprobe (gegenproben/postenart-aus-fest.patch, nur in der CI messbar):
 *   Postenart.aus() liefert immer SET → rot „jede Postenart kommt als dieselbe an“
 * Gegenprobe (nur in der CI messbar, nicht durchgeführt): ZustandSerializer mit
 *   PrimitiveKind.STRING statt SerialKind.ENUM → rot „Setnummern und Merkposten
 *   kommen unverändert an“ (Navigation findet keinen NavType für das Feld)
 */
@RunWith(RobolectricTestRunner::class)
class RoutenRundwegTest {

    @get:Rule
    val compose = createComposeRule()

    /** Was das Ziel beim Aufbau gelesen hat, je Eintrag im Rückstapel. */
    private val gelesen = mutableMapOf<String, Any>()

    private lateinit var nav: NavHostController

    private fun aufbauen() {
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = AnmeldeZiel.Setup) {
                composable<AnmeldeZiel.Setup> {}
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

    /** Navigiert zum Ziel und gibt zurück, was das Ziel gelesen hat. */
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
    fun `Titel mit Sonderzeichen kommen unverändert an`() {
        aufbauen()
        for (t in titel) {
            val teil = TeileZiel.ManualItemDetail(Postenart.PART, "3001 b", 4, t)
            assertEquals("Teil „$t“", teil, hin(teil))
            val kauf = SammlungZiel.AcquisitionManagement(Postenart.FIG, "sw0001+", 0, t)
            assertEquals("Kauf „$t“", kauf, hin(kauf))
        }
    }

    @Test
    fun `jede Postenart kommt als dieselbe an`() {
        aufbauen()
        for (art in Postenart.entries) {
            val kauf = SammlungZiel.AcquisitionManagement(art, "3001", 4, "Stein")
            assertEquals(kauf, hin(kauf))
            assertEquals(art, Postenart.aus(art.kennung))
        }
    }

    @Test
    fun `der Scanner weiss, von wo er geoeffnet wurde`() {
        aufbauen()
        for (herkunft in Scannerherkunft.entries) {
            assertEquals(SammlungZiel.BarcodeScanner(herkunft), hin(SammlungZiel.BarcodeScanner(herkunft)))
        }
    }

    @Test
    fun `ohne Farbe kommt keine Farbe an, nicht Schwarz`() {
        aufbauen()
        assertEquals(KEINE_FARBE, (hin(TeileZiel.ManualItemDetail(Postenart.FIG, "sw0001", title = "Luke")) as TeileZiel.ManualItemDetail).colorId)
    }

    @Test
    fun `der PDF-Betrachter bekommt nur seinen Schluessel`() {
        // Adresse (samt Ticket) und Titel bleiben in der PdfAuswahl (PdfAuswahlTest).
        aufbauen()
        val pdf = FinanzZiel.PdfViewer("0f8e2c1a-7d3b-4c55-9a0e-1b2c3d4e5f60")
        assertEquals(pdf, hin(pdf))
    }

    @Test
    fun `Setnummern und Merkposten kommen unverändert an`() {
        aufbauen()
        for (sn in listOf("75192-1", "col23-1", "a b/c%", "10 % +1")) {
            assertEquals(SammlungZiel.SetDetail(sn), hin(SammlungZiel.SetDetail(sn)))
            assertEquals(KatalogZiel.CatalogDetail(sn), hin(KatalogZiel.CatalogDetail(sn)))
            assertEquals(SammlungZiel.MerkpostenDetail(sn, Zustand.GEBRAUCHT), hin(SammlungZiel.MerkpostenDetail(sn, Zustand.GEBRAUCHT)))
        }
    }
}
