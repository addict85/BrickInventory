package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.finanzen.ui.screens.FinanceRoute
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Die Zeilen der Finanztabelle zeigen dasselbe wie im Web: den Kaufpreis bei Sets UND
 * bei manuell erfassten Teilen und Figuren. Gezeichnet gegen den Testserver der
 * Beispielwelt, mit einem Teil und einer Figur samt Kaufpreis.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   finanz-manuelle-zeile-ohne-kauf  ManualFinanceRow zeigt den Kaufpreis nicht → rot „Teile und Figuren …“
 *   finanz-teilzeile-ohne-kauf       die Teile reichen den Kaufpreis nicht durch → rot, derselbe Test
 *   finanz-figurzeile-ohne-kauf      die Figuren reichen ihn nicht durch → rot, derselbe Test
 *   finanz-setzeile-ohne-kauf        die Set-Zeile zeigt ihn nicht → rot „die Set-Zeile …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class FinanzKaufpreisZeilenTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()
    private val welt = Beispiele.Welt(KontextTexte())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    private val kaufpreis by lazy { ctx.getString(R.string.finance_purchase_short, "").trim() }

    private fun zeige() {
        welt.pfade.antworten["/api/v1/finance/parts-valuation"] = """{"success":true,"currency":"CHF","parts":[
            {"id":9,"part_number":"3001","part_name":"Brick 2 x 4","color_id":5,"quantity":1,"purchase_price":0.96,
             "avg_price":1.25,"wert_gesamt":1.25}],"total_value":"1.25"}"""
        welt.pfade.antworten["/api/v1/finance/minifigs-valuation"] = """{"success":true,"currency":"CHF","figs":[
            {"id":3,"fig_number":"sw0001","fig_name":"Luke Skywalker","quantity":1,"purchase_price":4.35,
             "avg_price":6.5,"wert_gesamt":6.5}],"total_value":"6.50"}"""
        val vm = welt.finanzen().also { it.loadValuation() }
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
                }
            }
        }
        treibeBis("Finanzen", bereit = { vm.financeState.value.let { it.valuation != null && it.figsValuation != null } })
        compose.waitForIdle()
    }

    /** Rollt zur Zeile mit [betrag] und sieht nach, dass dort der Kaufpreis steht. */
    private fun kaufpreisSteht(betrag: String) {
        val zeile = hasText(kaufpreis, substring = true) and hasText(betrag, substring = true)
        // Neben der Liste rollt auch die Reihe der Kennzahlen; gerollt wird, wer die Zeile hat.
        val listen = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        val gefunden = (0 until listen).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(zeile) }.isSuccess
        }
        assertTrue("Keine Zeile mit „$kaufpreis … $betrag“", gefunden)
        compose.onNode(zeile, useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `Teile und Figuren zeigen ihren Kaufpreis wie die Sets`() {
        zeige()
        kaufpreisSteht("0.96")
        kaufpreisSteht("4.35")
    }

    @Test
    fun `die Set-Zeile zeigt den Kaufpreis weiterhin`() {
        zeige()
        kaufpreisSteht("700.00")
    }
}
