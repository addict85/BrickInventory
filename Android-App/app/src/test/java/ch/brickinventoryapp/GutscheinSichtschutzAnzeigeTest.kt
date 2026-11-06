package ch.brickinventoryapp

import ch.brickinventoryapp.ui.viewmodel.DateiRef
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.ui.screens.GutscheinPdfSchutz
import ch.brickinventoryapp.ui.screens.GutscheineRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.ui.viewmodel.gutscheinPdfAdresse
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Gutscheinseite und Gutschein-PDF setzen FLAG_SECURE, ausgeführt (sec17 A-N4); eine
 * Bauanleitung im selben Betrachter nicht. Ersetzt die Quelltext-Prüfung in
 * feature-finanzen/GutscheinSichtschutzTest.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   gutscheinseite-ohne-sichtschutz  Sichtschutz() aus GutscheineRoute entfernt → rot
 *                                    „die Gutscheinseite …“
 *   gutschein-pdf-ohne-sichtschutz   GutscheinPdfSchutz ohne Sichtschutz → rot „ein Gutschein-PDF …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class GutscheinSichtschutzAnzeigeTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun geschuetzt() =
        (compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    @Test
    fun `die Gutscheinseite ist geschuetzt, solange sie steht`() {
        val pfade = PfadServer()
        val vm = GutscheinViewModel(
            repo = GutscheineRepository(pfade.imTakt(), ResponseCache { File(compose.activity.cacheDir, "g") }),
            texte = NummernTexte,
            leser = object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null },
            meldungen = MeldungsKanal(),
        )
        val sichtbar = mutableStateOf(true)
        compose.setContent {
            BrickInventoryManagerTheme {
                if (sichtbar.value) GutscheineRoute(vm, SnackbarHostState(), onZurueck = {})
            }
        }
        compose.waitForIdle()
        assertTrue("Nummer und PIN stünden in Bildschirmfotos", geschuetzt())
        sichtbar.value = false
        compose.waitForIdle()
        assertFalse("Nach dem Verlassen bleibt die App geschützt", geschuetzt())
    }

    @Test
    fun `ein Gutschein-PDF ist geschuetzt, eine Bauanleitung nicht`() {
        val adresse = mutableStateOf(gutscheinPdfAdresse("https://brick.example/", 7))
        compose.setContent { GutscheinPdfSchutz(adresse.value) }
        compose.waitForIdle()
        assertTrue("Ein Gutschein-PDF stünde in Bildschirmfotos", geschuetzt())
        adresse.value = "https://brick.example/api/v1/instructions/42/file"
        compose.waitForIdle()
        assertFalse("Eine Bauanleitung braucht keinen Schutz", geschuetzt())
    }
}
