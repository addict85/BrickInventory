package ch.brickinventoryapp.anmeldung

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.AppSperre
import ch.brickinventoryapp.ui.components.LocalAppSperre
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Die Einrichtung bietet die App-Sperre an, mit Erklärung und derselben Wahl wie die
 * Einstellungen.
 *
 * Gegenprobe (Robolectric, nur in der CI messbar):
 *   die Karte in SetupScreen entfernt → rot „die Einrichtung bietet die App-Sperre an …“;
 *   gegenproben/einrichtung-ohne-app-sperre.patch
 */
@RunWith(RobolectricTestRunner::class)
class EinrichtungAppSperreTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private class Speicher : AppSperre.Ablage {
        var minuten = AppSperre.VORGABE_MINUTEN
        override fun minuten() = minuten
        override fun setzeMinuten(minuten: Int) { this.minuten = minuten }
        override fun hintergrundSeit(): Long? = null
        override fun merkeHintergrund(seit: Long?) = Unit
        override fun hintergrundStart(): Int? = null
        override fun merkeHintergrundStart(start: Int?) = Unit
        override fun gesperrt() = false
        override fun setzeGesperrt(an: Boolean) = Unit
    }

    @Test
    fun `die Einrichtung bietet die App-Sperre an, mit Erklaerung`() {
        val sperre = AppSperre({ 0L }, Speicher())
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalAppSperre provides sperre) {
                    SetupScreen(currentUrl = "", onSave = {})
                }
            }
        }
        val ctx = compose.activity
        compose.onNodeWithText(ctx.getString(R.string.app_sperre_einrichten)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.app_sperre_titel)).assertExists()
        // Die gewählte Stufe ist die der Ablage: dieselbe Wahl wie in den Einstellungen.
        compose.onNodeWithText(ctx.getString(R.string.app_sperre_minuten, AppSperre.VORGABE_MINUTEN)).assertExists()
        assertEquals(AppSperre.VORGABE_MINUTEN, sperre.minuten.value)
    }
}
