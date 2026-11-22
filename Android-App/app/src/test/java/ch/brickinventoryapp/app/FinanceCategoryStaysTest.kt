package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.HiltTestActivity
import ch.brickinventoryapp.app.testing.RegisterHiltTestActivity
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.resources.R
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The finances' category filter lives in the tab's state: chosen, then away into the vouchers and
 * back, it is still chosen. Run on [TestApp].
 *
 * Counter-check (run here): FinanceScreen keeps the categories in a `remember { mutableStateOf(…) }`
 * of its own → red “the chosen category stays …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class FinanceCategoryStaysTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val app = TestApp()

    @After fun tearDown() = app.close()

    private fun idle() { driveUntil("idle", { app.world.paths.requests.size }) { true }; compose.waitForIdle() }
    private fun node(label: Int) = compose.onAllNodes(hasText(ctx.getString(label)) and hasClickAction()).onFirst()
    private fun scrollTo(label: Int) = compose.onNode(hasScrollToNodeAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange))
        .performScrollToNode(hasText(ctx.getString(label)))
    private fun tap(label: Int) { node(label).performClick(); idle() }
    private fun chosen(label: Int) = node(label).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Selected)

    @Test
    fun `the chosen category stays after a trip away from the tab`() {
        app.show(compose)
        idle()
        tap(R.string.nav_finance)
        scrollTo(R.string.finance_filter_parts)
        tap(R.string.finance_filter_parts)
        assertEquals(true, chosen(R.string.finance_filter_parts))
        scrollTo(R.string.vouchers_title)
        tap(R.string.vouchers_title)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        idle()
        scrollTo(R.string.finance_filter_parts)
        assertEquals("the category is lost after the vouchers", true, chosen(R.string.finance_filter_parts))
    }
}
