package ch.brickinventoryapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.model.util.Textquelle
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.state.ui.viewmodel.AppTexte
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
 * The one place that turns an error kind into a sentence, with real resources:
 * if the server sends a sentence, its sentence applies — it knows the case better and answers
 * in the account's language —, also for 401 and with an error code. Without a sentence
 * the app formulates itself.
 *
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   servermeldung-ohne-vorrang   the check for fehler.message removed → red “the server's sentence …”
 *   servermeldung-nach-code      the error code before the server message → red “the server's sentence …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppTextsTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val texts = AppTexte(object : Textquelle {
        override fun text(id: Int, vararg args: Any?) = ctx.getString(id, *args)
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = ctx.resources.getQuantityString(id, anzahl, *args)
    }, object : Anmeldestand {
        override val authTokenState: StateFlow<String?> = MutableStateFlow("token")
    })

    @Test
    fun `the server's sentence takes precedence over any own one`() {
        val satz = "Für dieses Datum gibt es schon einen Kaufpreis"
        assertEquals(satz, texts.meldung(Ergebnis.Fehler.Server(409, satz)))
        assertEquals("Auch bei 401", "Benutzername oder Passwort falsch",
            texts.meldung(Ergebnis.Fehler.Abgewiesen("Benutzername oder Passwort falsch")))
        assertEquals("Auch mit Fehlercode", satz, texts.meldung(Ergebnis.Fehler.Server(429, satz, Fehlercode.ZU_VIELE_VERBINDUNGEN)))

        val own = texts.meldung(Ergebnis.Fehler.Server(500))
        assertTrue("Ohne Satz des Servers steht keiner da", own.isNotBlank())
        assertNotEquals(own, texts.meldung(Ergebnis.Fehler.Server(429, "", Fehlercode.ZU_VIELE_VERBINDUNGEN)))
    }
}
