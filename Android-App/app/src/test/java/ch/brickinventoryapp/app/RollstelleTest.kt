package ch.brickinventoryapp.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Die Rollstelle hat eine Quelle, den ScrollMemory: Ein Ziel legt seinen Listenzustand
 * je Besuch neu an, und nach dem Ausflug ins Detail steht die Liste trotzdem wieder an
 * ihrer Stelle. Ausgeführt mit einem echten NavHost, wie die Reiter der App ihn haben.
 *
 * Gegenprobe (gegenproben/rolle-ohne-rueckkehr.patch): Der Keeper für LazyColumn springt
 * nicht mehr zurück → rot „die Liste steht nach dem Ausflug wieder an ihrer Stelle“.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class RollstelleTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `die Liste steht nach dem Ausflug wieder an ihrer Stelle, ohne hochgezogenen Zustand`() {
        val speicher = ScrollMemory()
        lateinit var nav: NavHostController
        val zustaende = mutableListOf<LazyListState>()
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = "liste") {
                composable("liste") {
                    val listState = remember { LazyListState() }
                    if (zustaende.lastOrNull() !== listState) zustaende += listState
                    ScrollPositionKeeper("probe", listState, bereit = true, speicher = speicher)
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        items(200) { Text("Zeile $it", Modifier.height(48.dp)) }
                    }
                }
                composable("detail") { Text("Detail") }
            }
        }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(60)
        compose.waitForIdle()
        assertEquals("Der Keeper schreibt die Stelle mit", 60, speicher.lies("probe").first)

        compose.runOnIdle { nav.navigate("detail") }
        compose.waitForIdle()
        compose.runOnIdle { nav.popBackStack() }
        compose.waitForIdle()

        assertEquals("Ein neuer Besuch, ein neuer Zustand", 2, zustaende.size)
        assertNotSame(zustaende[0], zustaende[1])
        assertEquals("die Liste steht nach dem Ausflug wieder an ihrer Stelle", 60, zustaende[1].firstVisibleItemIndex)
    }
}
