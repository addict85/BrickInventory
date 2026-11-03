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

    private fun pruefe(name: String, angehalten: Boolean, inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setFontScale(2f)
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

    @Test fun nurFelderAngehalten() = pruefe("nurFelderAngehalten", true) { felder() }
    @Test fun zustandAngehalten() = pruefe("zustandAngehalten", true) {
        ch.brickinventoryapp.ui.screens.Zustandszeile(zustand = "N", onZustand = {})
    }
    @Test fun lagerortAngehalten() = pruefe("lagerortAngehalten", true) {
        ch.brickinventoryapp.ui.screens.LagerortErfassung("", listOf("Keller", "Estrich"), {})
    }
    @Test fun allesAngehalten() = pruefe("allesAngehalten", true) {
        felder()
        ch.brickinventoryapp.ui.screens.Zustandszeile(zustand = "N", onZustand = {})
        ch.brickinventoryapp.ui.screens.LagerortErfassung("", listOf("Keller", "Estrich"), {})
    }
    @Test fun allesLaufend() = pruefe("allesLaufend", false) {
        felder()
        ch.brickinventoryapp.ui.screens.Zustandszeile(zustand = "N", onZustand = {})
        ch.brickinventoryapp.ui.screens.LagerortErfassung("", listOf("Keller", "Estrich"), {})
    }
}
