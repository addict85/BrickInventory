package ch.brickinventoryapp

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import ch.brickinventoryapp.nav.einzelstueckArgumente
import ch.brickinventoryapp.nav.farbArgument
import ch.brickinventoryapp.nav.merkpostenArgumente
import ch.brickinventoryapp.nav.pdfArgumente
import ch.brickinventoryapp.nav.setArgumente
import ch.brickinventoryapp.nav.textArgument
import ch.brickinventoryapp.ui.Screen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Hin- und Rückweg jeder Route mit Werten im Pfad durch einen echten NavHost: Was
 * createRoute einpackt, kommt im Ziel genau so an. Die Ziele benutzen dieselben
 * Argumentlisten und Leser wie die Graphen (nav/RoutenArgumente.kt).
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   route-doppelt-dekodiert   textArgument dekodiert wieder mit URLDecoder
 *                             → rot „Titel mit Sonderzeichen kommen unverändert an“
 *   route-leerzeichen-plus    routenSegment lässt Leerzeichen als „+“ stehen
 *                             → rot „Titel mit Sonderzeichen kommen unverändert an“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RoutenRundwegTest {

    @get:Rule
    val compose = createComposeRule()

    /** Was das Ziel beim Aufbau gelesen hat, je Eintrag im Rückstapel. */
    private val gelesen = mutableMapOf<String, List<Any>>()

    private lateinit var nav: NavHostController

    private fun ziel(entry: NavBackStackEntry, werte: List<Any>) {
        gelesen[entry.id] = werte
    }

    private fun aufbauen() {
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = "start") {
                composable("start") {}
                composable(Screen.SetDetail.route, setArgumente) {
                    ziel(it, listOf(it.textArgument("setNumber")))
                }
                composable(Screen.CatalogDetail.route, setArgumente) {
                    ziel(it, listOf(it.textArgument("setNumber")))
                }
                composable(Screen.MerkpostenDetail.route, merkpostenArgumente) {
                    ziel(it, listOf(it.textArgument("setNumber"), it.textArgument("condition")))
                }
                composable(Screen.ManualItemDetail.route, einzelstueckArgumente) {
                    ziel(it, listOf(it.textArgument("type"), it.textArgument("id"), it.farbArgument(), it.textArgument("title")))
                }
                composable(Screen.AcquisitionManagement.route, einzelstueckArgumente) {
                    ziel(it, listOf(it.textArgument("type"), it.textArgument("id"), it.farbArgument(), it.textArgument("title")))
                }
                composable(Screen.PdfViewer.route, pdfArgumente) {
                    ziel(it, listOf(it.textArgument("url"), it.textArgument("title")))
                }
            }
        }
        compose.waitForIdle()
    }

    /** Navigiert zur Route und gibt zurück, was das Ziel gelesen hat. */
    private fun hin(route: String): List<Any> {
        compose.runOnIdle { nav.navigate(route) }
        compose.waitForIdle()
        return compose.runOnIdle {
            val oben = nav.currentBackStackEntry!!
            checkNotNull(gelesen[oben.id]) { "Ziel für $route nicht aufgebaut (${oben.destination.route})" }
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
            assertEquals("Teil „$t“", listOf("part", "3001 b", 4, t),
                hin(Screen.ManualItemDetail.createRoute("part", "3001 b", 4, t)))
            assertEquals("Kauf „$t“", listOf("fig", "sw0001+", 0, t),
                hin(Screen.AcquisitionManagement.createRoute("fig", "sw0001+", 0, t)))
            assertEquals("PDF „$t“", listOf("https://srv/a.pdf", t),
                hin(Screen.PdfViewer.createRoute("https://srv/a.pdf", t)))
        }
    }

    @Test
    fun `PDF-Adressen mit Prozentzeichen bleiben kodiert`() {
        aufbauen()
        for (url in listOf(
            "https://srv/api/v1/anleitungen/Mein%20Plan%2B1.pdf",
            "https://cdn.example/6/1/123456.pdf?ticket=a%2Fb+c&x=%25",
            "https://srv/Bauanleitung Teil 2.pdf",
        )) {
            assertEquals(url, hin(Screen.PdfViewer.createRoute(url, "Anleitung"))[0])
        }
    }

    @Test
    fun `Setnummern und Merkposten kommen unverändert an`() {
        aufbauen()
        for (sn in listOf("75192-1", "col23-1", "a b/c%", "10 % +1")) {
            assertEquals(listOf(sn), hin(Screen.SetDetail.createRoute(sn)))
            assertEquals(listOf(sn), hin(Screen.CatalogDetail.createRoute(sn)))
            assertEquals(listOf(sn, "U"), hin(Screen.MerkpostenDetail.createRoute(sn, "U")))
        }
    }
}
