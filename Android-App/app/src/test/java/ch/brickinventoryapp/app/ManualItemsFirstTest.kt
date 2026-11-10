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
import ch.brickinventoryapp.model.ui.ScrollSpeicher
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.teile.ui.screens.MinifigsRoute
import ch.brickinventoryapp.teile.ui.screens.PartsRoute
import ch.brickinventoryapp.testing.Quellen
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
 * Teile und Minifiguren beginnen bei den manuell erfassten Einträgen. Die Set-Teile
 * kommen meist zuerst an, und das Raster hält beim Einfügen oben den sichtbaren
 * Eintrag fest; deshalb gehört zur Reihenfolge die Korrektur im Rollmerker, die
 * gespeicherte Stellen und eigene Gesten in Ruhe lässt.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   manuelle-teile-unten           der Abschnitt der manuellen Teile hinter den Set-Teilen → rot „Teile: die manuell …“
 *   nachzuegler-ohne-korrektur     die Korrektur rollt nicht mehr an den Anfang → rot „ohne gespeicherte Stelle …“
 *   korrektur-ueber-gespeicherte   die Korrektur ohne !hatteGespeicherte → rot „eine gespeicherte Stelle …“
 *   korrektur-ueber-geste          die Korrektur ohne !nutzerGeste → rot „nach einer eigenen Geste …“
 *   bereit-ohne-manuelle           Teile gelten ohne manualParts als geladen → rot „beide Listen zaehlen …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ManualItemsFirstTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val bilder = Beispielbilder.loader(ctx)
    private val welt = Beispiele.Welt(KontextTexte())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    private fun zeige(inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    /** Den Hauptlooper treiben, bis [bereit] gilt. */
    private fun warte(was: String, bereit: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); bereit() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: nach 10 s nicht da", e)
        }
        compose.waitForIdle()
    }

    private fun oben(text: String) = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.top

    @Test
    fun `Teile - die manuell erfassten stehen vor denen aus Sets`() {
        welt.pfade.antworten["/api/v1/parts/manual"] =
            """{"success":true,"parts":[{"id":7,"part_number":"3005","part_name":"Brick 1 x 1 manuell","color_id":1,"quantity":4}]}"""
        val vm = welt.teile().also { it.loadParts() }
        warte("Teile") { vm.partsState.value.let { it.parts.isNotEmpty() && !it.manualParts.isNullOrEmpty() } }
        zeige { PartsRoute(vm = vm, imageLoader = bilder) }
        val kopf = oben(ctx.getString(R.string.parts_manual_section))
        val kachel = oben("Brick 1 x 1 manuell")
        val ausSets = oben(ctx.getString(R.string.parts_sets_section))
        assertTrue("Reihenfolge: Kopf $kopf, manuelles Teil $kachel, „Aus Sets“ $ausSets", kopf < kachel && kachel < ausSets)
        assertTrue("Das erste Teil aus Sets steht nicht unter „Aus Sets“", oben("Brick 2 x 4") > ausSets)
    }

    @Test
    fun `Figuren - die manuell erfassten stehen vor denen aus Sets`() {
        welt.pfade.antworten["/api/v1/minifigs/manual"] =
            """{"success":true,"figs":[{"id":8,"fig_number":"sw0100","fig_name":"Prinzessin Leia manuell","quantity":1}]}"""
        val vm = welt.teile().also { it.loadMinifigs() }
        warte("Figuren") { vm.partsState.value.let { it.minifigs.isNotEmpty() && !it.manualFigs.isNullOrEmpty() } }
        zeige { MinifigsRoute(vm = vm, imageLoader = bilder) }
        val kopf = oben(ctx.getString(R.string.minifigs_manual_section))
        val kachel = oben("Prinzessin Leia manuell")
        val ausSets = oben(ctx.getString(R.string.minifigs_sets_section))
        assertTrue("Reihenfolge: Kopf $kopf, manuelle Figur $kachel, „Aus Sets“ $ausSets", kopf < kachel && kachel < ausSets)
        assertTrue("Die erste Figur aus Sets steht nicht unter „Aus Sets“",
            oben("Luke Skywalker (Pilot Suit, White Helmet)") > ausSets)
    }

    private val speicher = ScrollSpeicher()
    private val nachzuegler = mutableStateListOf<String>()
    private lateinit var raster: LazyGridState

    /** Ein Raster wie das der Teile: oben Platz für Nachzügler, darunter 40 Einträge aus Sets. */
    private fun zeigeRaster() {
        zeige {
            raster = rememberLazyGridState()
            LazyVerticalGrid(GridCells.Fixed(2), Modifier.height(300.dp).testTag("raster"), state = raster) {
                items(nachzuegler.toList(), key = { it }) { Text(it, Modifier.height(100.dp)) }
                items((0 until 40).map { "set-$it" }, key = { it }) { Text(it, Modifier.height(100.dp)) }
            }
            ScrollPositionKeeper("teile", raster, bereit = true, speicher = speicher, obenNachziehend = nachzuegler.size)
        }
    }

    private fun nachzueglerKommen() {
        nachzuegler.addAll((0 until 5).map { "manuell-$it" })
        compose.waitForIdle()
    }

    @Test
    fun `ohne gespeicherte Stelle zieht die Liste nach oben, wenn oben Eintraege nachkommen`() {
        zeigeRaster()
        nachzueglerKommen()
        assertEquals("Erster sichtbarer Eintrag", 0, raster.firstVisibleItemIndex)
        compose.onNodeWithText("manuell-0").fetchSemanticsNode()
    }

    @Test
    fun `eine gespeicherte Stelle bleibt, auch wenn oben Eintraege nachkommen`() {
        speicher.merke("teile", 10, 0)
        zeigeRaster()
        assertEquals("Wiederhergestellt", 10, raster.firstVisibleItemIndex)
        nachzueglerKommen()
        assertTrue("Die Liste sprang von der gespeicherten Stelle weg: ${raster.firstVisibleItemIndex}",
            raster.firstVisibleItemIndex >= 10)
    }

    @Test
    fun `nach einer eigenen Geste bleibt die Liste, wo der Nutzer sie hingerollt hat`() {
        zeigeRaster()
        compose.onNodeWithTag("raster").performTouchInput { swipeUp() }
        compose.waitForIdle()
        assertTrue("Die Geste hat nicht gerollt", raster.firstVisibleItemIndex > 0)
        nachzueglerKommen()
        assertTrue("Die Korrektur riss die Liste nach oben", raster.firstVisibleItemIndex > 0)
    }

    @Test
    fun `beide Listen zaehlen als geladen, nicht nur die aus den Sets`() {
        // Verdrahtung im Graphen: Erst wenn auch die manuellen Einträge da sind (null heisst
        // „noch nicht geladen“), stellt der Merker die Stelle wieder her.
        val graph = Quellen.ohneKommentare(Quellen.lies("app/nav/CollectionGraph.kt"))
        for ((schluessel, liste) in listOf("Screen.Parts.rollSchluessel" to "manualParts", "Screen.Minifigs.rollSchluessel" to "manualFigs")) {
            val block = Quellen.fenster(graph, "$schluessel, ", 12)
            assertTrue("Kein ScrollPositionKeeper für $schluessel gefunden", block.isNotEmpty())
            assertTrue("$schluessel: `bereit` wartet nicht auf $liste", block.contains("$liste != null"))
            assertTrue("$schluessel: obenNachziehend fehlt", block.contains("obenNachziehend ="))
        }
    }
}
