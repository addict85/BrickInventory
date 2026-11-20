package ch.brickinventoryapp.collection

import java.time.Instant
import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.screens.Kaufdatum
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * Das Kaufdatum in der Kaufpreis-Verwaltung: mit Etikett, in der Datumsform der
 * App-Sprache, als Knopf in voller Tippgrösse, der sagt, was er tut.
 *
 * Gegenprobe (gegenproben/kaufdatum-klein-ohne-etikett.patch, nur in der CI — Robolectric):
 *   ohne minimumInteractiveComponentSize und ohne onClickLabel → rot „das Kaufdatum ist ein
 *   beschrifteter Knopf …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en-rGB")
class PurchaseDateTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("en-GB")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    @Test
    fun `das Kaufdatum ist ein beschrifteter Knopf in voller Groesse, in der Datumsform der Sprache`() {
        var geoeffnet = 0
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { Kaufdatum(Instant.parse("2026-09-03T15:00:32.194Z")) { geoeffnet++ } }
            }
        }
        compose.waitForIdle()
        // Englisch mit Monatsnamen, nicht die feste deutsche Form mit Punkten.
        val button = compose.onNode(hasClickAction())
        compose.onNodeWithText("3 Sep 2026", useUnmergedTree = true).fetchSemanticsNode("Datum nicht in der Form der Sprache")
        compose.onNodeWithText(ctx.getString(R.string.acq_gekauft_am), useUnmergedTree = true).fetchSemanticsNode("Etikett fehlt")
        button.assertHeightIsAtLeast(48.dp)
        assertEquals(ctx.getString(R.string.acq_kaufdatum_aendern),
            button.fetchSemanticsNode().config.getOrNull(SemanticsActions.OnClick)?.label)
        button.performClick()
        assertEquals(1, geoeffnet)
    }
}
