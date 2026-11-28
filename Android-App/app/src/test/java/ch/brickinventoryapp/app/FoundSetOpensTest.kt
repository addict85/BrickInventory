package ch.brickinventoryapp.app

import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.network.util.NetworkAddressRules
import androidx.compose.runtime.CompositionLocalProvider
import android.content.Context
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.HiltTestActivity
import ch.brickinventoryapp.app.testing.RegisterHiltTestActivity
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.resources.R
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A scanned set that is already in the collection opens its detail page in the gallery, and the
 * trigger is reset, so the same set opens a second time. Run on [TestApp].
 *
 * Counter-checks (run here):
 *   `entryVm.gallerySearchFoundConsumed()` removed from EntryFrame → red “… opens a second time”;
 *   `onPresent(found)` removed from EntryFrame → red “a set already there opens its page”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class FoundSetOpensTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val app = TestApp()

    @After fun tearDown() = app.close()

    private fun idle() { driveUntil("idle", { app.world.paths.requests.size }) { true }; compose.waitForIdle() }
    private fun onDetail() = compose.onAllNodesWithText(ctx.getString(R.string.detail_section_details)).fetchSemanticsNodes().isNotEmpty()

    private fun scan(entry: EntryViewModel) {
        compose.runOnUiThread { entry.useScannedSetNumber("75192") }
        idle()
    }

    @Test
    fun `a set already there opens its page, and opens a second time`() {
        app.world.paths.responses["/api/v2/sets/exists/75192-1"] = """{"success":true,"exists":true,"set_number":"75192-1"}"""
        app.show(compose)
        idle()
        val entry = app.viewModels.created.filterIsInstance<EntryViewModel>().first()
        assertTrue("the gallery shows a detail before the scan", !onDetail())
        scan(entry)
        assertTrue("a set already there opens its page", onDetail())
        assertEquals("the trigger stays set", null, entry.barcodeState.value.foundSet)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        idle()
        assertTrue("back does not lead to the gallery", !onDetail())
        scan(entry)
        assertTrue("the same set does not open a second time", onDetail())
        assertTrue("the set was added instead of opened", app.world.paths.requestsTo("POST").isEmpty())
    }
}
