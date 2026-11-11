package ch.brickinventoryapp.verwaltung

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
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.verwaltung.ui.screens.CacheAndLimitsSection
import ch.brickinventoryapp.verwaltung.ui.screens.CacheEreignisse
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
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
class CacheLeerenFragtTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)
    private val geleert = mutableListOf<Boolean>()

    private fun zeige() {
        val ereignisse = CacheEreignisse(vorgabeZustand = {}, ablageLeeren = {}, netz = { _, _ -> }, design = {},
            cacheDauer = {}, cacheLeeren = { geleert += it }, grenzwerte = { _, _, _ -> })
        compose.setContent {
            BrickInventoryManagerTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    CacheAndLimitsSection(MonitoringUiState(),
                        mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false),
                        Design.CLASSIC, 0L, ereignisse)
                }
            }
        }
        compose.waitForIdle()
    }

    private fun imDialog(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun tippe(id: Int) {
        compose.onNode(hasText(text(id)) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
    }

    @Test
    fun `das Leeren fragt erst nach und leert dann im gewaehlten Umfang`() {
        zeige()
        tippe(R.string.monitoring_cache_clear_all)
        assertEquals("Ein Tipp allein leert schon", emptyList<Boolean>(), geleert)
        compose.onNodeWithText(text(R.string.monitoring_cache_clear_hint)).fetchSemanticsNode()
        imDialog(R.string.monitoring_cache_clear_confirm).performClick()
        compose.waitForIdle()

        tippe(R.string.monitoring_cache_clear_prices)
        imDialog(R.string.common_cancel).performClick()
        compose.waitForIdle()
        tippe(R.string.monitoring_cache_clear_prices)
        imDialog(R.string.monitoring_cache_clear_confirm).performClick()
        compose.waitForIdle()

        assertEquals("Alles, dann nach Abbrechen nichts, dann nur die Preise", listOf(true, false), geleert)
    }

    @Test
    fun `bei den Netzen steht der Hinweis zum gemessenen WLAN`() {
        zeige()
        compose.onNodeWithText(text(R.string.monitoring_vorwaermen_hinweis)).performScrollTo()
    }
}
