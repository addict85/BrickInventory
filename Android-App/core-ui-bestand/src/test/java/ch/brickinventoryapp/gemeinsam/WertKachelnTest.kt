package ch.brickinventoryapp.gemeinsam

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.gemeinsam.ui.AcquisitionSummarySection
import ch.brickinventoryapp.gemeinsam.ui.WertKacheln
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.model.KaufAnsicht
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ressourcen.R
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
 * Wert-Kacheln und Kaufpreis des Set-Details: Vierstellige Beträge stehen auf einem
 * schmalen Telefon ganz in einer Zeile, und bei 200 % Schrift steht der Kaufpreis
 * unter seiner Bezeichnung.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   wertkacheln-immer-drei          Wert-Kacheln immer zu dritt nebeneinander → rot „Wert-Kacheln … 100 Prozent“
 *   grosse-schrift-kaufpreis-daneben Kaufpreis neben der Bezeichnung → rot „Kaufpreis …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class WertKachelnTest {

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

    /**
     * Prüft je Betrag: eine Zeile, nichts ausgelassen und nicht breiter als seine
     * Kachel (mit softWrap = false liefe er sonst über den Rand). Kacheln derselben
     * Reihe sind gleich hoch.
     */
    private fun wertKachelnGanz(schrift: Float) {
        val markt = fmtMoney(1712.4, Waehrung.CHF)
        val kauf = fmtMoney(1500.0, Waehrung.CHF)
        val pnl = fmtProzent(14.2)
        zeige(schrift) {
            Box(Modifier.width(360.dp).padding(horizontal = 16.dp)) {
                WertKacheln(markt, kauf, 14.2)
            }
        }
        for (betrag in listOf(markt, kauf, pnl)) {
            val ergebnis = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(betrag, useUnmergedTree = true).fetchSemanticsNode()
                .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
            val t = ergebnis.single()
            assertEquals("$betrag in einer Zeile", 1, t.lineCount)
            assertTrue("$betrag ist abgeschnitten (rechts ${t.getLineRight(0)} von ${t.size.width})",
                !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == betrag.length &&
                    t.getLineRight(0) <= t.size.width + 0.5f)
        }
        val kacheln = listOf(R.string.detail_section_market, R.string.detail_purchase_price, R.string.detail_pnl_tile)
            .map { compose.onNodeWithText(ctx.getString(it), substring = true).fetchSemanticsNode().boundsInRoot }
        kacheln.groupBy { it.top }.values.filter { it.size > 1 }.forEach { reihe ->
            assertTrue("Kacheln einer Reihe gleich hoch: ${reihe.map { it.height }}",
                reihe.all { kotlin.math.abs(it.height - reihe[0].height) < 1f })
        }
    }

    @Test
    fun `Wert-Kacheln zeigen vierstellige Betraege auf schmalem Telefon bei 100 Prozent ganz`() = wertKachelnGanz(1f)

    @Test
    fun `Wert-Kacheln zeigen vierstellige Betraege auf schmalem Telefon bei 200 Prozent ganz`() = wertKachelnGanz(2f)

    @Test
    fun `Kaufpreis bei 200 Prozent steht unter der Bezeichnung in einer Zeile`() {
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                AcquisitionSummarySection(listOf(KaufAnsicht(id = 1, quantity = 1, purchasePrice = 700.0)), Waehrung.CHF) {}
            }
        }
        val betrag = compose.onNodeWithText(fmtMoney(700.0, Waehrung.CHF), useUnmergedTree = true)
        assertEquals(1, zeilen(betrag))
        val bezeichnung = compose.onNodeWithText(ctx.getString(R.string.detail_purchase_price)).fetchSemanticsNode().boundsInRoot
        assertTrue("Der Betrag steht unter der Bezeichnung", betrag.fetchSemanticsNode().boundsInRoot.top >= bezeichnung.bottom)
    }
}
