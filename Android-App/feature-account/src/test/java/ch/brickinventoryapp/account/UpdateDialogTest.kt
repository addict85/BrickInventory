package ch.brickinventoryapp.account

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.dialogs.UpdateDialog
import ch.brickinventoryapp.account.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LocalAppVersion
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
 *   update-spaeter-vergessen     dialogRejected nicht beachtet → rot „nach Später …“
 *   version-leer                 versionsName() ohne Rückfall → rot „ohne bekannte Version …“
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
        var closed = 0
        override fun pruefeAufUpdate(still: Boolean) = Unit
        override fun pruefeBeimStart() = Unit
        override fun setStartpruefung(an: Boolean) = Unit
        override fun closeUpdateHint() { closed++; spaeter() }
        override fun ladeUpdate() { geladen++ }
        override fun cancelLoad() = Unit
        override fun startInstallation() = Unit
    }

    @Test
    fun `the hint asks, loading starts only on the click`() {
        val aktionen = Aktionen()
        compose.setContent { BrickInventoryManagerTheme { UpdateDialog(UpdateUiState(newerVersion = neu), aktionen) } }
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.update_dialog_title)).fetchSemanticsNode()
        assertEquals("Das Zeigen allein lädt schon", 0, aktionen.geladen)

        compose.onNodeWithText(text(R.string.update_dialog_now)).performClick()
        compose.waitForIdle()
        assertEquals(1, aktionen.geladen)
    }

    @Test
    fun `after Later the hint does not ask again in this run`() {
        var zustand by mutableStateOf(UpdateUiState(newerVersion = neu))
        val aktionen = Aktionen { zustand = zustand.copy(dialogRejected = true) }
        compose.setContent { BrickInventoryManagerTheme { UpdateDialog(zustand, aktionen) } }
        compose.waitForIdle()

        compose.onNodeWithText(text(R.string.update_dialog_later)).performClick()
        compose.waitForIdle()

        assertEquals(1, aktionen.closed)
        assertEquals(0, aktionen.geladen)
        compose.onAllNodesWithText(text(R.string.update_dialog_title)).assertCountEquals(0)
    }

    @Test
    fun `without a known version unknown is shown, otherwise the version`() {
        var fassung by mutableStateOf(AppVersion("", 0))
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalAppVersion provides fassung) {
                    UpdateDialog(UpdateUiState(newerVersion = neu), Aktionen())
                }
            }
        }
        compose.waitForIdle()
        val unbekannt = text(R.string.update_version_unbekannt)
        compose.onNodeWithText(compose.activity.getString(R.string.update_dialog_text, "2.20", unbekannt))
            .fetchSemanticsNode("Die installierte Version bleibt leer")
        fassung = AppVersion("2.10", 10)
        compose.waitForIdle()
        compose.onNodeWithText(compose.activity.getString(R.string.update_dialog_text, "2.20", "2.10")).fetchSemanticsNode()
    }
}
