package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Die Kacheln manuell erfasster Teile und Figuren zeigen dasselbe wie die Webapp:
 * jeden erfassten Zustand, die Besitzer im Haushalt und den mengengewichteten
 * Kaufpreis vor dem zuletzt geschriebenen. Gezeichnet aus Antworten des Testservers,
 * damit auch das Durchreichen der Felder in jede der beiden Kacheln geprüft ist.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   kachel-teil-ohne-besitzer       ManualPartTile reicht die Besitzer nicht weiter → rot „Teil zeigt …“
 *   kachel-figur-ohne-zustaende     ManualFigTile reicht die Zustände nicht weiter → rot „Figur zeigt …“
 *   kachel-preis-zuletzt-geschrieben  unit_price vor avg_purchase_price → rot „Teil zeigt …“
 *   figuren-kennzahlen-an-liste     die Kennzahlen der Figuren hängen an der Set-Liste → rot „die Kennzahlen …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ManualTileDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val bilder = SampleImages.loader(ctx)
    private val world = Examples.Welt(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    private fun zeige(inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    private fun wait(was: String, bereit: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); bereit() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: nach 10 s nicht da", e)
        }
        compose.waitForIdle()
    }

    /** Zustände, Besitzer und beide Preise: Gemittelt 5.–, zuletzt geschrieben 8.–. */
    private val felder = """"quantity":4,"unit_price":8.0,"avg_purchase_price":5.0,"condition":"U","conditions":["N","U"],""" +
        """"owners":[{"id":2,"username":"Anna"},{"id":3,"username":"Beat"}]"""

    private fun showsEverything(wer: String) {
        for (text in listOf(ctx.getString(R.string.condition_new), ctx.getString(R.string.condition_used), "Anna", "Beat")) {
            assertTrue("$wer zeigt „$text“ nicht",
                compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        }
        val preis = fmtMoney(5.0, Waehrung("CHF"))
        assertTrue("$wer zeigt nicht den gemittelten Kaufpreis $preis",
            compose.onAllNodesWithText(preis, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun `the manual part shows conditions, owners and the averaged purchase price`() {
        world.paths.antworten["/api/v1/parts/manual"] =
            """{"success":true,"parts":[{"id":7,"part_number":"3005","part_name":"Brick 1 x 1","color_id":1,$felder}]}"""
        val vm = world.teile().also { it.loadParts() }
        wait("Teile") { !vm.teileState.value.manualParts.isNullOrEmpty() }
        zeige { PartsRoute(vm = vm, imageLoader = bilder) }
        compose.onNodeWithText("Brick 1 x 1", useUnmergedTree = true).fetchSemanticsNode()
        showsEverything("Teil")
    }

    @Test
    fun `the manual figure shows conditions, owners and the averaged purchase price`() {
        world.paths.antworten["/api/v1/minifigs/manual"] =
            """{"success":true,"figs":[{"id":8,"fig_number":"sw0100","fig_name":"Prinzessin Leia",$felder}]}"""
        val vm = world.figuren().also { it.loadMinifigs() }
        wait("Figuren") { !vm.minifigsState.value.manualFigs.isNullOrEmpty() }
        zeige { MinifigsRoute(vm = vm, imageLoader = bilder) }
        compose.onNodeWithText("Prinzessin Leia", useUnmergedTree = true).fetchSemanticsNode()
        showsEverything("Figur")
    }

    @Test
    fun `the key figures of the figures stay, even without figures from sets`() {
        // Sie meinen die ganze Sammlung (/minifigs/stats), nicht die geladene Liste.
        world.paths.antworten["/api/v1/minifigs"] = """{"success":true,"figs":[]}"""
        world.paths.antworten["/api/v1/minifigs/manual"] =
            """{"success":true,"figs":[{"id":8,"fig_number":"sw0100","fig_name":"Prinzessin Leia","quantity":1}]}"""
        val vm = world.figuren().also { it.loadMinifigs() }
        wait("Figuren") { vm.minifigsState.value.let { !it.manualFigs.isNullOrEmpty() && it.minifigStats.types > 0 } }
        zeige { MinifigsRoute(vm = vm, imageLoader = bilder) }
        compose.onNodeWithText("Prinzessin Leia", useUnmergedTree = true).fetchSemanticsNode()
        val typen = ctx.resources.getQuantityString(R.plurals.minifigs_stat_types, 2, "2")
        assertTrue("Die Kennzahlen „$typen“ fehlen",
            compose.onAllNodesWithText(typen, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
    }
}
