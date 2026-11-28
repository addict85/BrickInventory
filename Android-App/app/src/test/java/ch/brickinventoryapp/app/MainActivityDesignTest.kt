package ch.brickinventoryapp.app

import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.lifecycle.ViewModelProvider
import ch.brickinventoryapp.model.appearance.Brightness
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * MainActivity draws the design the person chose: started under Robolectric with the real
 * application, switched to dark through its own AppearanceViewModel, the window turns dark.
 *
 * Counter-checks (local, Robolectric):
 *   MainActivity passes `dark = false` to the theme       → red “dark …”
 *   MainActivity ignores `brightness` (passes SYSTEM)      → red “dark …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-port-notnight")
class MainActivityDesignTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    /** Mean brightness of the drawn window, 0 (black) to 1 (white). */
    private fun lightness(): Double {
        compose.waitForIdle()
        val pixels = compose.onRoot().captureToImage().toPixelMap()
        var sum = 0.0
        var n = 0
        for (x in 0 until pixels.width step 8) for (y in 0 until pixels.height step 8) {
            val c = pixels[x, y]
            sum += (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue); n++
        }
        return sum / n
    }

    @Test
    fun `MainActivity draws the effective design`() {
        val appearance = ViewModelProvider(compose.activity)[AppearanceViewModel::class.java]
        compose.runOnUiThread { appearance.setBrightness(Brightness.LIGHT) }
        val light = lightness()
        compose.runOnUiThread { appearance.setBrightness(Brightness.DARK) }
        val dark = lightness()
        // The setup screen draws no background of its own: the window's (light, system) shows
        // between the cards, so dark is measured as a clear drop, not as a dark window.
        assertTrue("light $light, dark $dark", light > 0.8 && light - dark > 0.25)
        compose.runOnUiThread { appearance.setBrightness(Brightness.LIGHT) }
        assertTrue("back to light", lightness() > 0.8)
    }
}
