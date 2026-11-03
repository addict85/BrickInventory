package ch.brickinventoryapp

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Vorübergehend: welcher Baustein des Erfassen-Dialogs bei 200 % nicht zur Ruhe kommt. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class DiagnoseDialogTest {
    @get:Rule val compose = createComposeRule()

    private fun pruefe(name: String, angehalten: Boolean, skala: Float = 2f, inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setFontScale(skala)
        val offen = mutableStateOf(false)
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic", dunkel = false) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    if (offen.value) ch.brickinventoryapp.ui.components.ErfassenDialog(
                        titel = "Titel", bestaetigen = "OK", onBestaetigen = {}, onAbbrechen = {},
                    ) { inhalt() }
                }
            }
        }
        if (angehalten) compose.mainClock.autoAdvance = false
        offen.value = true
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        val n = compose.onAllNodes(hasAnyAncestor(isDialog()), useUnmergedTree = true).fetchSemanticsNodes().size
        println("DIAGNOSE $name: ruhig, $n Knoten")
    }

    @Composable private fun felder() {
        repeat(3) { i ->
            OutlinedTextField(value = "", onValueChange = {}, label = { Text("Feld $i") },
                supportingText = { Text("Hilfe $i") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        }
    }

    @Test fun feld150() = pruefe("feld150", false, 1.5f) { felder() }
    @Test fun feld130() = pruefe("feld130", false, 1.3f) { felder() }
    @Test fun feldOhneBeschriftung200() = pruefe("feldOhneBeschriftung200", false) {
        OutlinedTextField(value = "", onValueChange = {}, modifier = Modifier.fillMaxWidth(), singleLine = true)
    }
    @Test fun basisFeld200() = pruefe("basisFeld200", false) {
        androidx.compose.foundation.text.BasicTextField(value = "x", onValueChange = {})
    }
    @Test fun nurText200() = pruefe("nurText200", false) { Text("Nur ein Text") }
    @Config(sdk = [33])
    @Test fun feld200Sdk33() = pruefe("feld200Sdk33", false) { felder() }
}
