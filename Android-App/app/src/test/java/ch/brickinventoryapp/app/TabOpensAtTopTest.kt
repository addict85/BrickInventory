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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.zustand.ui.CsvImportUiState
import ch.brickinventoryapp.zustand.ui.Screen
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
 *   reiter-meldet-nach-navigation      onTabAngetippt erst nach zuReiter → rot „die untere Leiste meldet …“
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
    private val gemeldet = mutableListOf<Pair<Screen, Boolean>>()
    private lateinit var nav: NavHostController

    private fun zeige() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                nav = rememberNavController()
                val reiter = remember {
                    listOf(
                        Reiter(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                        Reiter(Screen.Finance, { Icon(Icons.Default.ViewInAr, null) }, "Finanzen"))
                }
                MainScaffold(
                    title = "Sammlung", navController = nav, bottomNavItems = reiter,
                    snackbarHostState = remember { SnackbarHostState() },
                    csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
                    onCsvAbbrechen = {},
                    onTabAngetippt = { ziel -> gemeldet += ziel to (nav.currentDestination?.hasRoute<Screen.Gallery>() == true) },
                ) {
                    NavHost(nav, startDestination = Screen.Gallery) {
                        composable<Screen.Gallery> { }
                        composable<Screen.Parts> { }
                        composable<Screen.Finance> { }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `die untere Leiste meldet den Reiter, bevor sie navigiert`() {
        zeige()
        compose.onNodeWithText("Finanzen").performClick()
        compose.waitForIdle()
        assertEquals(listOf(Screen.Finance to true), gemeldet)
        assertTrue("Die Leiste navigiert nicht mehr", nav.currentDestination?.hasRoute<Screen.Finance>() == true)
    }

    @Test
    fun `der Sammlungs-Umschalter meldet den Reiter, bevor er navigiert`() {
        zeige()
        compose.onNodeWithText(ctx.getString(R.string.nav_parts)).performClick()
        compose.waitForIdle()
        assertEquals(listOf(Screen.Parts to true), gemeldet)
        assertTrue("Der Umschalter navigiert nicht mehr", nav.currentDestination?.hasRoute<Screen.Parts>() == true)
    }

    @Test
    fun `kein Reiter-Ziel baut das Geruest selbst`() {
        // Struktur: ReiterGeruest setzt den Rückruf einmal; ein Ziel, das MainScaffold
        // selbst baut, müsste ihn wieder von Hand durchreichen.
        val ziele = Quellen.unter("nav")
        assertTrue("Nur ${ziele.size} Dateien unter nav/ — Pfad veraltet?", ziele.size >= 3)
        val direkt = ziele.filter { Quellen.ohneKommentare(it.readText()).contains("MainScaffold(") }
        assertTrue("Diese Ziele bauen MainScaffold selbst statt ReiterGeruest: ${direkt.joinToString { it.name }}",
            direkt.isEmpty())
        val geruest = Quellen.ohneKommentare(Quellen.lies("app/MainScaffold.kt"))
        assertTrue("Das Gerüst verwirft die Rollposition des angetippten Reiters nicht mehr",
            geruest.contains("onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(ziel.rollSchluessel) }"))
    }
}
