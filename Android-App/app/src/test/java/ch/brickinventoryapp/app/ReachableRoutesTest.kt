package ch.brickinventoryapp.app

import android.content.Context
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
import ch.brickinventoryapp.account.ui.AccountTarget
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.Tab
import ch.brickinventoryapp.app.nav.TargetEnvironment
import ch.brickinventoryapp.catalog.ui.CatalogTarget
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.management.ui.ManagementTarget
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.StartTarget
import kotlinx.serialization.descriptors.StructureKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Every destination is in the app's graph, and a path leads to every destination without values.
 * The list of destinations comes from the serialization of the routes of each area, not
 * by hand; the graph is the same the NavHost builds ([allTargets]).
 *
 * Counter-checks (measurable only in CI, Robolectric):
 *   target-not-registered   composable<AccountTarget.Konto> missing in the graph
 *                            → red “every destination is in the app's graph“
 *   target-without-way            the entry „CSV-Import“ missing on “More”
 *                            → red “a path leads to every destination without values“
 */
@RunWith(RobolectricTestRunner::class)
class ReachableRoutesTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    /** The routes of every area and of the app; a new area belongs in this list. */
    private val routes = listOf(LoginTarget.serializer(), CollectionTarget.serializer(), CatalogTarget.serializer(),
        PartsTarget.serializer(), FinanceTarget.serializer(), AccountTarget.serializer(), ManagementTarget.serializer(),
        AppTarget.serializer())

    /** Serial name per destination; for destinations without values also the name of their route. */
    private val targets = routes.flatMap { r ->
        val d = r.descriptor.getElementDescriptor(1)
        (0 until d.elementsCount).map { d.getElementName(it) to d.getElementDescriptor(it).kind }
    }.toMap()

    private fun name(target: Any) = checkNotNull(target::class.qualifiedName)

    private fun routes(graph: NavGraph): List<String> = graph.flatMap { target: NavDestination ->
        if (target is NavGraph) routes(target) else listOfNotNull(target.route)
    }

    @Test
    fun `every destination is in the app's graph`() {
        lateinit var nav: NavHostController
        compose.setContent { nav = rememberNavController() }
        val graph = compose.runOnIdle {
            val environment = TargetEnvironment(nav, coil3.ImageLoader.Builder(ctx).build(), emptyList(), SnackbarHostState()) {
                // Only the destinations fetch the state when drawing; the graph alone does not need it.
                error("destinations are not drawn here")
            }
            nav.createGraph(startDestination = CollectionTarget.Gallery) { allTargets(environment) }
        }
        val registered = routes(graph).map { it.substringBefore('/').substringBefore('?') }.toSet()
        assertTrue("Only ${targets.size} destinations found — does the search still read the serialization?", targets.size >= 20)
        assertEquals("destinations without a place in the graph", emptySet<String>(), targets.keys - registered)
    }

    @Test
    fun `a path leads to every destination without values`() {
        val ofMore = mutableListOf<Any>()
        lateinit var bar: List<Tab>
        compose.setContent {
            bar = tabTheBar()
            MoreScreen(onTarget = { ofMore += it }, isAdmin = true, onLogout = {})
        }
        val items = compose.onAllNodes(hasClickAction() and !hasText(ctx.getString(R.string.main_menu_logout)))
        val count = items.fetchSemanticsNodes().size
        for (i in 0 until count) {
            items[i].performScrollTo().performClick()
        }
        compose.waitForIdle()
        // Material provides at most five tabs: the inventory destinations, the wishlist and
        // “More”. The price comparison only opens the browser and stands on “More”.
        assertEquals(listOf(CollectionTarget.Gallery, FinanceTarget.Finance, CatalogTarget.Catalog, CollectionTarget.Wanted, AppTarget.More),
            bar.map { it.target })
        assertTrue("the price comparison is on “More”", CollectionTarget.Comparison in ofMore)
        assertEquals("every entry on “More” names exactly one destination", count, ofMore.size)
        assertTrue("the settings are on “More”", AccountTarget.Settings in ofMore)
        assertFalse("the server switch belongs in the settings, not on “More”", LoginTarget.Setup in ofMore)

        val reached = (ofMore + bar.map { it.target } + COLLECTION_TARGETS +
            StartTarget.entries.map(::startRoute)).map(::name).toSet()
        // Destinations with values are only opened by whoever has the values (a tile, a row).
        val withoutValues = targets.filterValues { it == StructureKind.OBJECT }.keys
        assertTrue("Only ${withoutValues.size} destinations without values found", withoutValues.size >= 15)
        assertEquals("destinations without a way there", emptySet<String>(), withoutValues - reached)
    }
}
