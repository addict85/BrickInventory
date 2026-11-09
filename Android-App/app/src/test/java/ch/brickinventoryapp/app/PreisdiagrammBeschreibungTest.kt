package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.ui.model.PreisPunktAnsicht
import ch.brickinventoryapp.model.ui.model.PreisReiheAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.screens.PriceChart
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtAmount
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Das Preisdiagramm im Set-Detail ist für TalkBack keine leere Fläche: Seine Zeichnung
 * trägt eine Beschreibung mit Zustand, Anfang, Ende, Tief und Hoch jeder Linie.
 *
 * Gegenprobe (gegenproben/preisdiagramm-stumm.patch, Robolectric, misst die CI): die
 * Semantik am Canvas entfernt → rot „das Preisdiagramm beschreibt …“.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class PreisdiagrammBeschreibungTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    @Test
    fun `das Preisdiagramm beschreibt seine Linie in Worten`() {
        val verlauf = PreisDiagrammAnsicht(values = listOf(PreisReiheAnsicht("N",
            listOf(PreisPunktAnsicht("2026-01-01", 710.0), PreisPunktAnsicht("2026-02-01", 690.0), PreisPunktAnsicht("2026-03-01", 730.0)))))
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                Surface(color = MaterialTheme.colorScheme.background) { PriceChart(verlauf, "CHF") }
            }
        }
        compose.waitForIdle()
        val neu = ctx.getString(R.string.condition_new)
        compose.onNode(hasContentDescription(neu, substring = true) and hasContentDescription(fmtAmount(690.0), substring = true)
            and hasContentDescription(fmtAmount(730.0), substring = true)).fetchSemanticsNode()
    }
}
