package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.app.nav.Reiter
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
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel
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
 * Ein angetippter Reiter beginnt oben: Das Gerüst meldet das Antippen, bevor es
 * navigiert, damit der Rollmerker die Stelle verwirft, ehe der Bildschirm sie liest.
 * „Ich komme zurück“ behält die Stelle; unterscheiden lässt sich das nur im Gerüst.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   reiter-meldet-nach-navigation      onTabAngetippt erst nach toTab → rot „die untere Leiste meldet …“
 *   umschalter-meldet-nach-navigation  im Sammlungs-Umschalter ebenso → rot „der Sammlungs-Umschalter meldet …“
 *   geruest-vergisst-nicht             ReiterGeruest verwirft die Rollposition nicht → rot „kein Reiter-Ziel …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class TabOpensAtTopTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    /** Gemeldetes Ziel und ob beim Melden noch die Galerie offen war. */
    private val gemeldet = mutableListOf<Pair<Any, Boolean>>()
    private lateinit var nav: NavHostController

    private fun zeige() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                nav = rememberNavController()
                val tab = remember {
                    listOf(
                        Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                        Reiter(FinanzZiel.Finance, { Icon(Icons.Default.ViewInAr, null) }, "Finanzen"))
                }
                MainScaffold(
                    title = "Sammlung", navController = nav, bottomNavItems = tab,
                    snackbarHostState = remember { SnackbarHostState() },
                    csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                    onCsvAbbrechen = {},
                    onTabAngetippt = { ziel -> gemeldet += ziel to (nav.currentDestination?.hasRoute<SammlungZiel.Gallery>() == true) },
                ) {
                    NavHost(nav, startDestination = SammlungZiel.Gallery) {
                        composable<SammlungZiel.Gallery> { }
                        composable<TeileZiel.Parts> { }
                        composable<FinanzZiel.Finance> { }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `the bottom bar reports the tab before it navigates`() {
        zeige()
        compose.onNodeWithText("Finanzen").performClick()
        compose.waitForIdle()
        assertEquals(listOf(FinanzZiel.Finance to true), gemeldet)
        assertTrue("Die Leiste navigiert nicht mehr", nav.currentDestination?.hasRoute<FinanzZiel.Finance>() == true)
    }

    @Test
    fun `the collection switcher reports the tab before it navigates`() {
        zeige()
        compose.onNodeWithText(ctx.getString(R.string.nav_parts)).performClick()
        compose.waitForIdle()
        assertEquals(listOf(TeileZiel.Parts to true), gemeldet)
        assertTrue("Der Umschalter navigiert nicht mehr", nav.currentDestination?.hasRoute<TeileZiel.Parts>() == true)
    }

    @Test
    fun `no tab destination builds the scaffold itself`() {
        // Struktur: ReiterGeruest setzt den Rückruf einmal; ein Ziel, das MainScaffold
        // selbst baut, müsste ihn wieder von Hand durchreichen.
        val targets = Quellen.unter("nav")
        assertTrue("Nur ${targets.size} Dateien unter nav/ — Pfad veraltet?", targets.size >= 3)
        val direkt = targets.filter { Quellen.withoutComments(it.readText()).contains("MainScaffold(") }
        assertTrue("Diese Ziele bauen MainScaffold selbst statt ReiterGeruest: ${direkt.joinToString { it.name }}",
            direkt.isEmpty())
        val geruest = Quellen.withoutComments(Quellen.lies("app/MainScaffold.kt"))
        assertTrue("Das Gerüst verwirft die Rollposition des angetippten Reiters nicht mehr",
            geruest.contains("onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(rollSchluessel(ziel)) }"))
    }
}
