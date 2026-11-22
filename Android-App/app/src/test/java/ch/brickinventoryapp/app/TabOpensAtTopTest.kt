package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.app.nav.Tab
import android.content.Context
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.parts.ui.PartsTarget
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A tapped tab starts at the top: the scaffold reports the tap before it
 * navigates, so that the scroll memory discards the position before the screen reads it.
 * “I come back” keeps the position; this can only be distinguished in the scaffold.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   reiter-meldet-nach-navigation      onTabTapped only after toTab → red “the bottom bar reports …”
 *   umschalter-meldet-nach-navigation  likewise in the collection switcher → red “the collection switcher reports …”
 *   geruest-vergisst-nicht             TabScaffold does not discard the scroll position → red “no tab destination …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class TabOpensAtTopTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    /** Reported destination and whether the gallery was still open when reporting. */
    private val reported = mutableListOf<Pair<Any, Boolean>>()
    private lateinit var nav: NavHostController

    private fun show() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                nav = rememberNavController()
                val tab = remember {
                    listOf(
                        Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                        Tab(FinanceTarget.Finance, { Icon(Icons.Default.ViewInAr, null) }, "Finanzen"))
                }
                MainScaffold(
                    title = "Sammlung", navController = nav, bottomNavItems = tab,
                    snackbarHostState = remember { SnackbarHostState() },
                    csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                    onCsvCancel = {},
                    onTabTapped = { target -> reported += target to (nav.currentDestination?.hasRoute<CollectionTarget.Gallery>() == true) },
                ) {
                    NavHost(nav, startDestination = CollectionTarget.Gallery) {
                        composable<CollectionTarget.Gallery> { }
                        composable<PartsTarget.Parts> { }
                        composable<FinanceTarget.Finance> { }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `the bottom bar reports the tab before it navigates`() {
        show()
        compose.onNodeWithText("Finanzen").performClick()
        compose.waitForIdle()
        assertEquals(listOf(FinanceTarget.Finance to true), reported)
        assertTrue("Die Leiste navigiert nicht mehr", nav.currentDestination?.hasRoute<FinanceTarget.Finance>() == true)
    }

    @Test
    fun `the collection switcher reports the tab before it navigates`() {
        show()
        compose.onNodeWithText(ctx.getString(R.string.nav_parts)).performClick()
        compose.waitForIdle()
        assertEquals(listOf(PartsTarget.Parts to true), reported)
        assertTrue("Der Umschalter navigiert nicht mehr", nav.currentDestination?.hasRoute<PartsTarget.Parts>() == true)
    }

    @Test
    fun `no tab destination builds the scaffold itself`() {
        // Structure: TabScaffold sets the callback once; a destination that builds MainScaffold
        // itself would have to pass it through by hand again.
        val targets = Sources.below("nav")
        assertTrue("Nur ${targets.size} Dateien unter nav/ — Pfad veraltet?", targets.size >= 3)
        val direct = targets.filter { Sources.withoutComments(it.readText()).contains("MainScaffold(") }
        assertTrue("Diese Ziele bauen MainScaffold selbst statt TabScaffold: ${direct.joinToString { it.name }}",
            direct.isEmpty())
        val scaffold = Sources.withoutComments(Sources.read("app/MainScaffold.kt"))
        assertTrue("Das Gerüst verwirft die Rollposition des angetippten Reiters nicht mehr",
            scaffold.contains("onTabTapped = { target -> vm.scrollMemory.forgetTab(rollKey(target)) }"))
    }
}
