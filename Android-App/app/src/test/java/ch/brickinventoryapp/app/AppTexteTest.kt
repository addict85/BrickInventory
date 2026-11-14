package ch.brickinventoryapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.vertrag.Fehlercode
import ch.brickinventoryapp.zustand.ui.viewmodel.AppTexte
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die eine Stelle, die aus einer Fehlerart einen Satz macht, mit echten Ressourcen:
 * Schickt der Server einen Satz, gilt seiner — er kennt den Fall genauer und antwortet
 * in der Sprache des Kontos —, auch bei 401 und mit Fehlercode. Ohne Satz formuliert
 * die App selbst.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   servermeldung-ohne-vorrang   die Prüfung auf fehler.message entfernt → rot „der Satz des Servers …“
 *   servermeldung-nach-code      der Fehlercode vor der Servermeldung → rot „der Satz des Servers …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppTexteTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val texte = AppTexte(ctx, object : Anmeldestand {
        override val authTokenState: StateFlow<String?> = MutableStateFlow("token")
    })

    @Test
    fun `der Satz des Servers hat Vorrang vor jedem eigenen`() {
        val satz = "Für dieses Datum gibt es schon einen Kaufpreis"
        assertEquals(satz, texte.meldung(Ergebnis.Error.Server(409, satz)))
        assertEquals("Auch bei 401", "Benutzername oder Passwort falsch",
            texte.meldung(Ergebnis.Error.Abgewiesen("Benutzername oder Passwort falsch")))
        assertEquals("Auch mit Fehlercode", satz, texte.meldung(Ergebnis.Error.Server(429, satz, Fehlercode.ZU_VIELE_VERBINDUNGEN)))

        val eigen = texte.meldung(Ergebnis.Error.Server(500))
        assertTrue("Ohne Satz des Servers steht keiner da", eigen.isNotBlank())
        assertNotEquals(eigen, texte.meldung(Ergebnis.Error.Server(429, "", Fehlercode.ZU_VIELE_VERBINDUNGEN)))
    }
}
