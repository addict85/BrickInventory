package ch.brickinventoryapp.management

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.management.ui.screens.CacheAndLimitsSection
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Der Preis-Cache der Überwachung leert erst nach einer Rückfrage: Jeder Neuaufbau kostet
 * Anfragen aus dem gemeinsamen Tageskontingent, ein Fehlgriff nähme allen anderen etwas
 * weg. Bestätigt wird im gewählten Umfang, Abbrechen leert nichts. Bei den Netzen des
 * Vorwärmens steht der Hinweis zum gemessenen WLAN.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   cache-leeren-ohne-frage    „Alles leeren“ leert sofort → rot „das Leeren fragt …“
 *   vorwaermen-hinweis-fehlt   der Hinweis zum gemessenen WLAN fehlt → rot „bei den Netzen …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CacheClearAsksTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)
    private val geleert = mutableListOf<Boolean>()

    private fun zeige() {
        val events = CacheEvents(defaultState = {}, clearStore = {}, netz = { _, _ -> }, design = {},
            cacheDuration = {}, cacheLeeren = { geleert += it }, limits = { _, _, _ -> })
        compose.setContent {
            BrickInventoryManagerTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    CacheAndLimitsSection(MonitoringUiState(),
                        mapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false),
                        Design.CLASSIC, 0L, events)
                }
            }
        }
        compose.waitForIdle()
    }

    private fun inDialog(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun tap(id: Int) {
        compose.onNode(hasText(text(id)) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
    }

    @Test
    fun `clearing asks first and then clears in the chosen scope`() {
        zeige()
        tap(R.string.monitoring_cache_clear_all)
        assertEquals("Ein Tipp allein leert schon", emptyList<Boolean>(), geleert)
        compose.onNodeWithText(text(R.string.monitoring_cache_clear_hint)).fetchSemanticsNode()
        inDialog(R.string.monitoring_cache_clear_confirm).performClick()
        compose.waitForIdle()

        tap(R.string.monitoring_cache_clear_prices)
        inDialog(R.string.common_cancel).performClick()
        compose.waitForIdle()
        tap(R.string.monitoring_cache_clear_prices)
        inDialog(R.string.monitoring_cache_clear_confirm).performClick()
        compose.waitForIdle()

        assertEquals("Alles, dann nach Abbrechen nichts, dann nur die Preise", listOf(true, false), geleert)
    }

    @Test
    fun `the networks show the hint about metered Wi-Fi`() {
        zeige()
        compose.onNodeWithText(text(R.string.monitoring_vorwaermen_hinweis)).performScrollTo()
    }
}
