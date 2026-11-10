package ch.brickinventoryapp.app

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.navigation.NavDestination
import androidx.navigation.NavGraph
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController
import androidx.navigation.createGraph
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.app.nav.Rollzustaende
import ch.brickinventoryapp.app.nav.ZielUmgebung
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.Screen
import ch.brickinventoryapp.zustand.ui.StartZiel
import kotlinx.serialization.descriptors.StructureKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import android.content.Context

/**
 * Jedes Ziel steht im Graphen der App, und zu jedem Ziel ohne Werte führt ein Weg.
 * Die Liste der Ziele kommt aus der Serialisierung von [Screen], nicht von Hand;
 * der Graph ist derselbe, den der NavHost baut ([alleZiele]).
 *
 * Gegenproben (nur in der CI messbar, Robolectric):
 *   ziel-nicht-registriert   composable<Screen.Konto> fehlt im Graphen
 *                            → rot „jedes Ziel steht im Graphen der App“
 *   ziel-ohne-weg            der Eintrag „CSV-Import“ fehlt auf „Mehr“
 *                            → rot „zu jedem Ziel ohne Werte führt ein Weg“
 */
@RunWith(RobolectricTestRunner::class)
class ErreichbareRoutenTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    /** Serienname je Ziel; für Ziele ohne Werte zugleich der Name ihrer Route. */
    private val ziele = Screen.serializer().descriptor.getElementDescriptor(1).let { d ->
        (0 until d.elementsCount).associate { d.getElementName(it) to d.getElementDescriptor(it).kind }
    }

    private fun name(ziel: Screen) = checkNotNull(ziel::class.qualifiedName)

    private fun routen(graph: NavGraph): List<String> = graph.flatMap { ziel: NavDestination ->
        if (ziel is NavGraph) routen(ziel) else listOfNotNull(ziel.route)
    }

    @Test
    fun `jedes Ziel steht im Graphen der App`() {
        lateinit var nav: NavHostController
        compose.setContent { nav = rememberNavController() }
        val graph = compose.runOnIdle {
            val umgebung = ZielUmgebung(nav, coil3.ImageLoader.Builder(ctx).build(), emptyList(), SnackbarHostState(),
                Rollzustaende(LazyGridState(), LazyGridState(), LazyGridState(), LazyListState(), LazyListState(), ScrollState(0))) {
                // Den Zustand holen erst die Ziele beim Zeichnen; der Graph allein braucht ihn nicht.
                error("Ziele werden hier nicht gezeichnet")
            }
            nav.createGraph(startDestination = Screen.Setup) { alleZiele(umgebung) }
        }
        val registriert = routen(graph).map { it.substringBefore('/').substringBefore('?') }.toSet()
        assertTrue("Nur ${ziele.size} Ziele gefunden — liest die Suche die Serialisierung noch?", ziele.size >= 20)
        assertEquals("Ziele ohne Platz im Graphen", emptySet<String>(), ziele.keys - registriert)
    }

    @Test
    fun `zu jedem Ziel ohne Werte führt ein Weg`() {
        val vonMehr = mutableListOf<Screen>()
        lateinit var leiste: List<Reiter>
        compose.setContent {
            leiste = reiterDerLeiste()
            MehrBildschirm(onZiel = { vonMehr += it }, isAdmin = true, updateVerfuegbar = false, onAbmelden = {})
        }
        val eintraege = compose.onAllNodes(hasClickAction() and !hasText(ctx.getString(R.string.main_menu_logout)))
        val anzahl = eintraege.fetchSemanticsNodes().size
        for (i in 0 until anzahl) {
            eintraege[i].performScrollTo().performClick()
        }
        compose.waitForIdle()
        // Material sieht höchstens fünf Reiter vor: die Bestandsziele in der Folge der
        // Webapp (Merkliste vor Katalog) und „Mehr“.
        assertEquals(listOf(Screen.Gallery, Screen.Finance, Screen.Wanted, Screen.Catalog, Screen.Mehr),
            leiste.map { it.first })
        assertEquals("Jeder Eintrag auf „Mehr“ nennt genau ein Ziel", anzahl, vonMehr.size)
        assertTrue("Die Einstellungen stehen auf „Mehr“", Screen.Settings in vonMehr)
        assertFalse("Der Serverwechsel gehört in die Einstellungen, nicht auf „Mehr“", Screen.Setup in vonMehr)

        val erreicht = (vonMehr + leiste.map { it.first } + SAMMLUNGS_ZIELE +
            StartZiel.entries.map(::startRoute)).map(::name).toSet()
        // Ziele mit Werten öffnet nur, wer die Werte hat (eine Kachel, eine Zeile).
        val ohneWerte = ziele.filterValues { it == StructureKind.OBJECT }.keys
        assertTrue("Nur ${ohneWerte.size} Ziele ohne Werte gefunden", ohneWerte.size >= 15)
        assertEquals("Ziele ohne Weg dorthin", emptySet<String>(), ohneWerte - erreicht)
    }
}
