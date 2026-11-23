package ch.brickinventoryapp.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Catalog names stay English; in a German UI a small hint says so, in an English UI it
 * would only repeat the obvious and is missing.
 *
 * Counter-checks (not locally runnable, to be checked in CI — Robolectric):
 *   CatalogNameHint() without the `german()` check → red “in English …” (one node instead of none)
 *   CatalogNameHint() returning early always → red “in German …” (no node)
 */
@RunWith(RobolectricTestRunner::class)
class CatalogNameHintTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun hints(): Int {
        compose.setContent { BrickInventoryManagerTheme { CatalogNameHint() } }
        compose.waitForIdle()
        return compose.onAllNodesWithText(compose.activity.getString(R.string.catalog_name_english))
            .fetchSemanticsNodes().size
    }

    @Test
    @Config(sdk = [35], qualifiers = "de-rCH")
    fun `in German the English name is marked`() = assertEquals(1, hints())

    @Test
    @Config(sdk = [35], qualifiers = "en")
    fun `in English there is no hint`() = assertEquals(0, hints())
}
