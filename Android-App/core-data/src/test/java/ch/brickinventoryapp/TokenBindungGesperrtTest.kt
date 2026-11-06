package ch.brickinventoryapp

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.EntwertungsPlaner
import ch.brickinventoryapp.data.Entwertungsauftrag
import ch.brickinventoryapp.data.GeraeteAblage
import ch.brickinventoryapp.data.TokenAblage
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.TokenVerschluesselung
import ch.brickinventoryapp.util.Tresorbefund
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import java.io.File

/**
 * Ein Token geht nur an den Server, der es ausgab — auch wenn der Keystore beim
 * Serverwechsel gesperrt ist und der Speicher deshalb „kein Token“ meldet.
 * Echte TokenAblage auf Robolectric, ein Neustart ist eine neue Instanz.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   wechsel-nach-speicher        saveServerUrl entscheidet wieder über tokenJetzt() →
 *                                rot „ein gesperrter Keystore …“ (das Token von A liegt noch da)
 *   verworfenes-token-vergessen  kein Auftrag für das verworfene Token → rot, derselbe Test
 *                                („A wird nachgeholt abgemeldet“)
 *   altbestand-ungebunden        bindeAltbestand() nicht aufgerufen → rot „ein Token
 *                                aelterer Fassungen …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenBindungGesperrtTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val bereiche = mutableListOf<CoroutineScope>()
    private val geplant = Collections.synchronizedList(mutableListOf<Entwertungsauftrag>())

    /** Die ersten [sperren] Öffnungen antworten „gesperrt“, danach ist der Keystore wieder da. */
    private class Tresor(sperren: Int) : TokenVerschluesselung {
        private val rest = AtomicInteger(sperren)
        override fun verschluessle(klartext: String) = "ENC:$klartext"
        override fun entschluessle(gespeichert: String) = gespeichert.removePrefix("ENC:")
        override fun oeffne(gespeichert: String): Tresorbefund =
            if (rest.getAndDecrement() > 0) Tresorbefund.Gesperrt else Tresorbefund.Lesbar(entschluessle(gespeichert))
    }

    /** Je Test eine eigene Datei; DataStore erlaubt je Datei nur eine Instanz im Prozess. */
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "bindung-${System.nanoTime()}.preferences_pb") }

    /** Ein Prozessstart: neue Instanz, eigener Bereich, dieselbe Platte. */
    private fun start(tresor: TokenVerschluesselung): TokenAblage {
        val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { bereiche += it }
        return TokenAblage(store, tresor, GeraeteAblage(ctx, store), bereich) { EntwertungsPlaner { geplant += it } }
            .also { it.warteAufStart() }
    }

    private fun beende() = bereiche.forEach { it.cancel() }.also { bereiche.clear() }

    private fun platte() = runBlocking { store.data.first() }

    @After
    fun zu() = beende()

    @Test
    fun `ein gesperrter Keystore beim Serverwechsel laesst kein Token von A zurueck`() {
        val a = "https://a.example"
        val b = "https://b.example"
        val erst = start(Tresor(0))
        runBlocking {
            erst.saveServerUrl(a)
            erst.saveAuthToken("tA")
        }
        assertEquals(NetworkPolicy.herkunft(a), platte()[TokenAblage.TOKEN_HERKUNFT])
        beende()

        // Neustart: Die ersten vier Öffnungen (Anlauf) sind gesperrt, der Speicher meldet "".
        val gesperrt = start(Tresor(4))
        runBlocking {
            assertEquals("Der Anlauf meldet die Anmeldemaske", "", gesperrt.tokenJetzt())
            gesperrt.saveServerUrl(b)
        }
        val p = platte()
        assertFalse("Das Token von A liegt nach dem Wechsel noch da", TokenAblage.AUTH_TOKEN_ENC in p.asMap())
        assertFalse(TokenAblage.AUTH_TOKEN in p.asMap())
        assertFalse(TokenAblage.TOKEN_HERKUNFT in p.asMap())
        val auftrag = runBlocking { gesperrt.entwertungsauftrag() }
        assertTrue("Ein Auftrag für B trüge das Token von A dorthin: $auftrag", auftrag == null || auftrag.serverUrl == a)
        assertEquals("A wird nachgeholt abgemeldet, mit dem Token von A", listOf(a to "ENC:tA"),
            geplant.map { it.serverUrl to it.tokenGeheim })
        assertEquals(NetworkPolicy.herkunft(a), geplant.single().herkunft)
        beende()

        // Der Keystore ist wieder da: Aus der Platte kommt kein Token von A zurück.
        val offen = start(Tresor(0))
        assertEquals("", runBlocking { offen.tokenJetzt() })
        assertEquals(b, runBlocking { offen.serverUrlJetzt() })
    }

    @Test
    fun `ein Token aelterer Fassungen wird beim Start an den eingetragenen Server gebunden`() {
        runBlocking {
            store.edit {
                it[TokenAblage.SERVER_URL] = "https://alt.example/brick"
                it[TokenAblage.AUTH_TOKEN_ENC] = "ENC:alt"
            }
        }
        val prefs = start(Tresor(0))
        val erwartet = NetworkPolicy.herkunft("https://alt.example/brick")
        assertEquals(erwartet, platte()[TokenAblage.TOKEN_HERKUNFT])
        assertEquals(erwartet, prefs.tokenHerkunftState.value)
        assertEquals("alt", runBlocking { prefs.tokenJetzt() })
    }
}
