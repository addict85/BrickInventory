package ch.brickinventoryapp.app

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import ch.brickinventoryapp.model.data.model.KEINE_FARBE
import ch.brickinventoryapp.zustand.ui.Postenart
import ch.brickinventoryapp.zustand.ui.Screen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Hin- und Rückweg jeder Route mit Werten durch einen echten NavHost: Was ein Ziel
 * mitbringt, liest `toRoute()` im Ziel genau so zurück — auch Sonderzeichen,
 * Prozentzeichen in PDF-Adressen und die Vorgabe „keine Farbe“.
 *
 * Gegenprobe (gegenproben/route-feld-transient.patch, nur in der CI messbar):
 *   ManualItemDetail.title als @Transient → rot „Titel mit Sonderzeichen kommen unverändert an“
 * Gegenprobe (gegenproben/postenart-aus-fest.patch, nur in der CI messbar):
 *   Postenart.aus() liefert immer SET → rot „jede Postenart kommt als dieselbe an“
 */
@RunWith(RobolectricTestRunner::class)
class RoutenRundwegTest {

    @get:Rule
    val compose = createComposeRule()

    /** Was das Ziel beim Aufbau gelesen hat, je Eintrag im Rückstapel. */
    private val gelesen = mutableMapOf<String, Screen>()

    private lateinit var nav: NavHostController

    private fun aufbauen() {
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = Screen.Setup) {
                composable<Screen.Setup> {}
                composable<Screen.SetDetail> { gelesen[it.id] = it.toRoute<Screen.SetDetail>() }
                composable<Screen.CatalogDetail> { gelesen[it.id] = it.toRoute<Screen.CatalogDetail>() }
                composable<Screen.MerkpostenDetail> { gelesen[it.id] = it.toRoute<Screen.MerkpostenDetail>() }
                composable<Screen.ManualItemDetail> { gelesen[it.id] = it.toRoute<Screen.ManualItemDetail>() }
                composable<Screen.AcquisitionManagement> { gelesen[it.id] = it.toRoute<Screen.AcquisitionManagement>() }
                composable<Screen.PdfViewer> { gelesen[it.id] = it.toRoute<Screen.PdfViewer>() }
            }
        }
        compose.waitForIdle()
    }

    /** Navigiert zum Ziel und gibt zurück, was das Ziel gelesen hat. */
    private fun hin(ziel: Screen): Screen {
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
            val teil = Screen.ManualItemDetail(Postenart.PART, "3001 b", 4, t)
            assertEquals("Teil „$t“", teil, hin(teil))
            val kauf = Screen.AcquisitionManagement(Postenart.FIG, "sw0001+", 0, t)
            assertEquals("Kauf „$t“", kauf, hin(kauf))
            val pdf = Screen.PdfViewer("https://srv/a.pdf", t)
            assertEquals("PDF „$t“", pdf, hin(pdf))
        }
    }

    @Test
    fun `jede Postenart kommt als dieselbe an`() {
        aufbauen()
        for (art in Postenart.entries) {
            val kauf = Screen.AcquisitionManagement(art, "3001", 4, "Stein")
            assertEquals(kauf, hin(kauf))
            assertEquals(art, Postenart.aus(art.kennung))
        }
    }

    @Test
    fun `ohne Farbe kommt keine Farbe an, nicht Schwarz`() {
        aufbauen()
        assertEquals(KEINE_FARBE, (hin(Screen.ManualItemDetail(Postenart.FIG, "sw0001", title = "Luke")) as Screen.ManualItemDetail).colorId)
    }

    @Test
    fun `PDF-Adressen mit Prozentzeichen bleiben kodiert`() {
        aufbauen()
        for (url in listOf(
            "https://srv/api/v1/anleitungen/Mein%20Plan%2B1.pdf",
            "https://cdn.example/6/1/123456.pdf?ticket=a%2Fb+c&x=%25",
            "https://srv/Bauanleitung Teil 2.pdf",
        )) {
            assertEquals(url, (hin(Screen.PdfViewer(url, "Anleitung")) as Screen.PdfViewer).url)
        }
    }

    @Test
    fun `Setnummern und Merkposten kommen unverändert an`() {
        aufbauen()
        for (sn in listOf("75192-1", "col23-1", "a b/c%", "10 % +1")) {
            assertEquals(Screen.SetDetail(sn), hin(Screen.SetDetail(sn)))
            assertEquals(Screen.CatalogDetail(sn), hin(Screen.CatalogDetail(sn)))
            assertEquals(Screen.MerkpostenDetail(sn, "U"), hin(Screen.MerkpostenDetail(sn, "U")))
        }
    }
}
