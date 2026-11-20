package ch.brickinventoryapp.app

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
import ch.brickinventoryapp.app.nav.TargetEnvironment
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.account.ui.KontoZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel
import ch.brickinventoryapp.management.ui.ManagementTarget
import ch.brickinventoryapp.state.ui.StartTarget
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
 * Die Liste der Ziele kommt aus der Serialisierung der Routen jedes Bereichs, nicht
 * von Hand; der Graph ist derselbe, den der NavHost baut ([allTargets]).
 *
 * Gegenproben (nur in der CI messbar, Robolectric):
 *   ziel-nicht-registriert   composable<KontoZiel.Konto> fehlt im Graphen
 *                            → rot „jedes Ziel steht im Graphen der App“
 *   ziel-ohne-weg            der Eintrag „CSV-Import“ fehlt auf „Mehr“
 *                            → rot „zu jedem Ziel ohne Werte führt ein Weg“
 */
@RunWith(RobolectricTestRunner::class)
class ReachableRoutesTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    /** Die Routen jedes Bereichs und der App; ein neuer Bereich gehört in diese Liste. */
    private val routen = listOf(LoginTarget.serializer(), SammlungZiel.serializer(), KatalogZiel.serializer(),
        TeileZiel.serializer(), FinanzZiel.serializer(), KontoZiel.serializer(), ManagementTarget.serializer(),
        AppTarget.serializer())

    /** Serienname je Ziel; für Ziele ohne Werte zugleich der Name ihrer Route. */
    private val targets = routen.flatMap { r ->
        val d = r.descriptor.getElementDescriptor(1)
        (0 until d.elementsCount).map { d.getElementName(it) to d.getElementDescriptor(it).kind }
    }.toMap()

    private fun name(ziel: Any) = checkNotNull(ziel::class.qualifiedName)

    private fun routen(graph: NavGraph): List<String> = graph.flatMap { ziel: NavDestination ->
        if (ziel is NavGraph) routen(ziel) else listOfNotNull(ziel.route)
    }

    @Test
    fun `jedes Ziel steht im Graphen der App`() {
        lateinit var nav: NavHostController
        compose.setContent { nav = rememberNavController() }
        val graph = compose.runOnIdle {
            val environment = TargetEnvironment(nav, coil3.ImageLoader.Builder(ctx).build(), emptyList(), SnackbarHostState()) {
                // Den Zustand holen erst die Ziele beim Zeichnen; der Graph allein braucht ihn nicht.
                error("Ziele werden hier nicht gezeichnet")
            }
            nav.createGraph(startDestination = SammlungZiel.Gallery) { allTargets(environment) }
        }
        val registered = routen(graph).map { it.substringBefore('/').substringBefore('?') }.toSet()
        assertTrue("Nur ${targets.size} Ziele gefunden — liest die Suche die Serialisierung noch?", targets.size >= 20)
        assertEquals("Ziele ohne Platz im Graphen", emptySet<String>(), targets.keys - registered)
    }

    @Test
    fun `zu jedem Ziel ohne Werte führt ein Weg`() {
        val ofMore = mutableListOf<Any>()
        lateinit var leiste: List<Reiter>
        compose.setContent {
            leiste = tabTheBar()
            MehrBildschirm(onTarget = { ofMore += it }, isAdmin = true, updateVerfuegbar = false, onAbmelden = {})
        }
        val eintraege = compose.onAllNodes(hasClickAction() and !hasText(ctx.getString(R.string.main_menu_logout)))
        val anzahl = eintraege.fetchSemanticsNodes().size
        for (i in 0 until anzahl) {
            eintraege[i].performScrollTo().performClick()
        }
        compose.waitForIdle()
        // Material sieht höchstens fünf Reiter vor: die Bestandsziele in der Folge der
        // Webapp (Merkliste vor Katalog) und „Mehr“.
        assertEquals(listOf(SammlungZiel.Gallery, FinanzZiel.Finance, SammlungZiel.Wanted, KatalogZiel.Catalog, AppTarget.Mehr),
            leiste.map { it.ziel })
        assertEquals("Jeder Eintrag auf „Mehr“ nennt genau ein Ziel", anzahl, ofMore.size)
        assertTrue("Die Einstellungen stehen auf „Mehr“", KontoZiel.Settings in ofMore)
        assertFalse("Der Serverwechsel gehört in die Einstellungen, nicht auf „Mehr“", LoginTarget.Setup in ofMore)

        val erreicht = (ofMore + leiste.map { it.ziel } + COLLECTION_TARGETS +
            StartTarget.entries.map(::startRoute)).map(::name).toSet()
        // Ziele mit Werten öffnet nur, wer die Werte hat (eine Kachel, eine Zeile).
        val withoutValues = targets.filterValues { it == StructureKind.OBJECT }.keys
        assertTrue("Nur ${withoutValues.size} Ziele ohne Werte gefunden", withoutValues.size >= 15)
        assertEquals("Ziele ohne Weg dorthin", emptySet<String>(), withoutValues - erreicht)
    }
}
