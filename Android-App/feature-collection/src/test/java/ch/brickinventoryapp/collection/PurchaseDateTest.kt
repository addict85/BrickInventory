package ch.brickinventoryapp.collection

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
import ch.brickinventoryapp.collection.ui.screens.PurchaseDate
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant
import java.util.Locale

/**
 * The purchase date in purchase price management: with a label, in the date format of the
 * app language, as a button in full tap size, that says what it does.
 *
 * Counter-check (counter-checks/kaufdatum-klein-ohne-etikett.patch, only in the CI — Robolectric):
 *   without minimumInteractiveComponentSize and without onClickLabel → red “the purchase date is a
 *   labelled button …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en-rGB")
class PurchaseDateTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("en-GB")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    @Test
    fun `the purchase date is a labelled full-size button in the language's date form`() {
        var opened = 0
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { PurchaseDate(Instant.parse("2026-09-03T15:00:32.194Z")) { opened++ } }
            }
        }
        compose.waitForIdle()
        // English with month names, not the fixed German form with dots.
        val button = compose.onNode(hasClickAction())
        compose.onNodeWithText("3 Sep 2026", useUnmergedTree = true).fetchSemanticsNode("Datum nicht in der Form der Sprache")
        compose.onNodeWithText(ctx.getString(R.string.acq_bought_at), useUnmergedTree = true).fetchSemanticsNode("Etikett fehlt")
        button.assertHeightIsAtLeast(48.dp)
        assertEquals(ctx.getString(R.string.acq_purchase_date_edit),
            button.fetchSemanticsNode().config.getOrNull(SemanticsActions.OnClick)?.label)
        button.performClick()
        assertEquals(1, opened)
    }
}
