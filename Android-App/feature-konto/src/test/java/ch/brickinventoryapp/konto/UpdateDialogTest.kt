package ch.brickinventoryapp.konto

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.konto.ui.UpdateUiState
import ch.brickinventoryapp.konto.ui.dialogs.UpdateDialog
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.update.util.UpdateBeschreibung
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Der Update-Hinweis beim Start, gezeichnet: Er fragt nur — geladen wird erst auf
 * „Jetzt aktualisieren“, nie beim Zeigen —, und nach „Später“ fragt er in diesem
 * App-Lauf nicht wieder. Dass „Später“ im Zustand landet und beim Abmelden verfällt,
 * prüft UpdateViewModelTest.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   update-dialog-laedt-selbst   LaunchedEffect lädt beim Zeigen → rot „der Hinweis fragt …“
 *   update-spaeter-vergessen     dialogAbgelehnt nicht beachtet → rot „nach Später …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpdateDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private val neu = UpdateBeschreibung(versionCode = 20, versionName = "2.20",
        apkUrl = "https://github.com/x/y/releases/download/android-v2.20/BrickInventory.apk")

    /** Zählt, was der Dialog auslöst; „Später“ setzt den Zustand wie das ViewModel. */
    private class Aktionen(val spaeter: () -> Unit = {}) : UpdateAktionen {
        var geladen = 0
        var geschlossen = 0
        override fun pruefeAufUpdate(still: Boolean) = Unit
        override fun pruefeBeimStart() = Unit
        override fun setzeStartpruefung(an: Boolean) = Unit
        override fun updateHinweisSchliessen() { geschlossen++; spaeter() }
        override fun ladeUpdate() { geladen++ }
        override fun ladeAbbrechen() = Unit
        override fun starteInstallation() = Unit
    }

    @Test
    fun `der Hinweis fragt, geladen wird erst auf den Klick`() {
        val aktionen = Aktionen()
        compose.setContent { BrickInventoryManagerTheme { UpdateDialog(UpdateUiState(neuereFassung = neu), aktionen) } }
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.update_dialog_title)).fetchSemanticsNode()
        assertEquals("Das Zeigen allein lädt schon", 0, aktionen.geladen)

        compose.onNodeWithText(text(R.string.update_dialog_now)).performClick()
        compose.waitForIdle()
        assertEquals(1, aktionen.geladen)
    }

    @Test
    fun `nach Spaeter fragt der Hinweis in diesem Lauf nicht wieder`() {
        var zustand by mutableStateOf(UpdateUiState(neuereFassung = neu))
        val aktionen = Aktionen { zustand = zustand.copy(dialogAbgelehnt = true) }
        compose.setContent { BrickInventoryManagerTheme { UpdateDialog(zustand, aktionen) } }
        compose.waitForIdle()

        compose.onNodeWithText(text(R.string.update_dialog_later)).performClick()
        compose.waitForIdle()

        assertEquals(1, aktionen.geschlossen)
        assertEquals(0, aktionen.geladen)
        compose.onAllNodesWithText(text(R.string.update_dialog_title)).assertCountEquals(0)
    }
}
