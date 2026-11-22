package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.ui.ScrollStorage
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
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
 * Parts and minifigures start with the manually added entries. The set parts
 * usually arrive first, and when inserting at the top the grid holds on to the visible
 * entry; that is why the order includes the correction in the scroll memory that
 * leaves saved positions and own gestures alone.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   manuelle-teile-unten           the section of manual parts behind the set parts → red “parts - the manually …”
 *   nachzuegler-ohne-korrektur     the correction no longer scrolls to the start → red “without a saved position …”
 *   korrektur-ueber-gespeicherte   the correction without !hadSaved → red “a saved position …”
 *   korrektur-ueber-geste          the correction without !userGesture → red “after an own gesture …”
 * That the graph waits for both lists before jumping back runs in TabScrollPositionTest.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ManualItemsFirstTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val images = SampleImages.loader(ctx)
    private val world = Examples.World(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private fun show(content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
        }
        compose.waitForIdle()
    }

    /** Drive the main looper until [ready] holds. */
    private fun wait(was: String, ready: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); ready() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: not there after 10 s", e)
        }
        compose.waitForIdle()
    }

    private fun top(text: String) = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.top

    @Test
    fun `parts - the manually added ones come before those from sets`() {
        world.paths.responses["/api/v1/parts/manual"] =
            """{"success":true,"parts":[{"id":7,"part_number":"3005","part_name":"Brick 1 x 1 manuell","color_id":1,"quantity":4}]}"""
        val vm = world.parts().also { it.loadParts() }
        wait("parts") { vm.partsState.value.let { it.parts.isNotEmpty() && !it.manualParts.isNullOrEmpty() } }
        show { PartsRoute(vm = vm, imageLoader = images) }
        val header = top(ctx.getString(R.string.parts_manual_section))
        val tile = top("Brick 1 x 1 manuell")
        val fromSets = top(ctx.getString(R.string.parts_sets_section))
        assertTrue("order: header $header, manual part $tile, “From sets” $fromSets", header < tile && tile < fromSets)
        assertTrue("the first part from sets does not stand below “From sets”", top("Brick 2 x 4") > fromSets)
    }

    @Test
    fun `figures - the manually added ones come before those from sets`() {
        world.paths.responses["/api/v1/minifigs/manual"] =
            """{"success":true,"figs":[{"id":8,"fig_number":"sw0100","fig_name":"Prinzessin Leia manuell","quantity":1}]}"""
        val vm = world.figures().also { it.loadMinifigs() }
        wait("figures") { vm.minifigsState.value.let { it.minifigs.isNotEmpty() && !it.manualFigs.isNullOrEmpty() } }
        show { MinifigsRoute(vm = vm, imageLoader = images) }
        val header = top(ctx.getString(R.string.minifigs_manual_section))
        val tile = top("Prinzessin Leia manuell")
        val fromSets = top(ctx.getString(R.string.minifigs_sets_section))
        assertTrue("order: header $header, manual figure $tile, “From sets” $fromSets", header < tile && tile < fromSets)
        assertTrue("the first figure from sets does not stand below “From sets”",
            top("Luke Skywalker (Pilot Suit, White Helmet)") > fromSets)
    }

    private val memory = ScrollStorage()
    private val stragglers = mutableStateListOf<String>()
    private lateinit var raster: LazyGridState

    /** A grid like that of the parts: room for latecomers at the top, below it 40 entries from sets. */
    private fun showRaster() {
        show {
            raster = rememberLazyGridState()
            LazyVerticalGrid(GridCells.Fixed(2), Modifier.height(300.dp).testTag("raster"), state = raster) {
                items(stragglers.toList(), key = { it }) { Text(it, Modifier.height(100.dp)) }
                items((0 until 40).map { "set-$it" }, key = { it }) { Text(it, Modifier.height(100.dp)) }
            }
            ScrollPositionKeeper("teile", raster, ready = true, memory = memory, topTrailing = stragglers.size)
        }
    }

    private fun stragglersCome() {
        stragglers.addAll((0 until 5).map { "manuell-$it" })
        compose.waitForIdle()
    }

    @Test
    fun `without a saved position the list moves up when entries arrive above`() {
        showRaster()
        stragglersCome()
        assertEquals("first visible entry", 0, raster.firstVisibleItemIndex)
        compose.onNodeWithText("manuell-0").fetchSemanticsNode()
    }

    @Test
    fun `a saved position stays, even when entries arrive above`() {
        memory.track("teile", 10, 0)
        showRaster()
        assertEquals("restored", 10, raster.firstVisibleItemIndex)
        stragglersCome()
        assertTrue("the list jumped away from the saved position: ${raster.firstVisibleItemIndex}",
            raster.firstVisibleItemIndex >= 10)
    }

    @Test
    fun `after an own gesture the list stays where the user scrolled it`() {
        showRaster()
        compose.onNodeWithTag("raster").performTouchInput { swipeUp() }
        compose.waitForIdle()
        assertTrue("the gesture did not scroll", raster.firstVisibleItemIndex > 0)
        stragglersCome()
        assertTrue("the correction tore the list to the top", raster.firstVisibleItemIndex > 0)
    }
}
