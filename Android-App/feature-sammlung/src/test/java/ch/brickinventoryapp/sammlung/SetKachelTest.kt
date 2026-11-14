package ch.brickinventoryapp.sammlung

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.sammlung.ui.KachelPreis
import ch.brickinventoryapp.sammlung.ui.screens.SetCard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Die Setkachel der Galerie: Bei 200 % Schrift bricht weder Betrag noch Prozent um,
 * und Kacheln einer Reihe sind gleich hoch, wie lang ihr Name auch ist; ein kurzer Name
 * lässt dafür keine Leerzeile unter sich.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   grosse-schrift-kachel-row       Prozent wieder neben dem Betrag in einer Row → rot „Kachel …“
 *   kachel-hoehe-nach-inhalt        die fehlende Namenszeile ohne Ausgleich → rot „Kacheln einer Reihe …“
 *   kachel-name-zwei-feste-zeilen   wieder minLines = 2 am Namen → rot „ein kurzer Name …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SetKachelTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun zeilen(knoten: SemanticsNodeInteraction): Int {
        val ergebnis = mutableListOf<TextLayoutResult>()
        knoten.fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single().lineCount
    }

    @Test
    fun `Kachel bei 200 Prozent bricht weder Betrag noch Prozent um`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        zeige(schrift = 2f) {
            Box(Modifier.width(188.dp)) {
                SetCard(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars"),
                    serverUrl = "", imageLoader = bilder, onClick = {},
                    preis = KachelPreis(812.5, 16.1), waehrung = Waehrung.CHF)
            }
        }
        assertEquals("Prozent", 1, zeilen(compose.onNodeWithText(fmtProzent(16.1), useUnmergedTree = true)))
        assertEquals("Betrag", 1, zeilen(compose.onNodeWithText(fmtMoney(812.5, Waehrung.CHF), useUnmergedTree = true)))
    }

    @Test
    fun `Kacheln einer Reihe sind gleich hoch`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        val voll = SetAnsicht(setNumber = "10294-1", name = "Titanic mit sehr langem Namen über zwei Zeilen",
            theme = "Icons", pieces = 9090, condition = Zustand.NEU)
        val karg = SetAnsicht(setNumber = "1-1", name = "Box")
        zeige {
            Row(Modifier.width(380.dp)) {
                Box(Modifier.weight(1f)) {
                    SetCard(voll, "", bilder, {}, preis = KachelPreis(449.95, 12.5), waehrung = Waehrung.CHF)
                }
                Box(Modifier.weight(1f)) { SetCard(karg, "", bilder, {}, waehrung = Waehrung.CHF) }
            }
        }
        val a = compose.onNode(hasText("10294-1") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val b = compose.onNode(hasText("1-1") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        assertEquals("Kacheln einer Reihe gleich hoch", a.height, b.height, 1f)
    }

    @Test
    fun `ein kurzer Name laesst keine Leerzeile unter sich`() {
        val bilder = coil3.ImageLoader.Builder(ctx).build()
        zeige {
            Box(Modifier.width(188.dp)) {
                SetCard(SetAnsicht(setNumber = "1-1", name = "Box"), "", bilder, {}, waehrung = Waehrung.CHF)
            }
        }
        val knoten = compose.onNodeWithText("Box", useUnmergedTree = true)
        val ergebnis = mutableListOf<TextLayoutResult>()
        knoten.fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        val zeile = ergebnis.single().let { it.getLineBottom(0) - it.getLineTop(0) }
        val hoehe = knoten.fetchSemanticsNode().boundsInRoot.height
        assertTrue("Der Name ist $hoehe px hoch, eine Zeile $zeile px", hoehe < zeile * 1.5f)
    }
}
