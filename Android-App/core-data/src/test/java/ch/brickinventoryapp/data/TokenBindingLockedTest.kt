package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.testVertrauenschiffre
import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.Tresorbefund
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
 * A token goes only to the server that issued it — even if the keystore is locked during
 * the server switch and memory therefore reports „no token“.
 * Real TokenAblage on Robolectric, a restart is a new instance.
 *
 * Counter-checks (Robolectric, measured by CI; job `gegenproben`):
 *   wechsel-nach-speicher        saveServerUrl decides via tokenJetzt() again →
 *                                red “a locked keystore …” (the token of A is still there)
 *   verworfenes-token-vergessen  no job for the discarded token → red, the same test
 *                                („A wird nachgeholt abgemeldet“)
 *   altbestand-ungebunden        bindLegacyStock() not called → red “a token
 *                                of older versions …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenBindingLockedTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()
    private val geplant = Collections.synchronizedList(mutableListOf<Entwertungsauftrag>())

    /** The first [sperren] openings answer „locked“, afterwards the keystore is back. */
    private class Tresor(sperren: Int) : TokenEncryption {
        private val rest = AtomicInteger(sperren)
        override fun verschluessle(klartext: String) = "ENC:$klartext"
        override fun entschluessle(gespeichert: String) = gespeichert.removePrefix("ENC:")
        override fun oeffne(gespeichert: String): Tresorbefund =
            if (rest.getAndDecrement() > 0) Tresorbefund.Gesperrt else Tresorbefund.Readable(entschluessle(gespeichert))
    }

    /** One file per test; DataStore allows only one instance per file in the process. */
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "bindung-${System.nanoTime()}.preferences_pb") }

    /** Ein Prozessstart: neue Instanz, eigener Bereich, dieselbe Platte. */
    private fun start(tresor: TokenEncryption): TokenAblage {
        val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenAblage(store, tresor, DevicesStore(ctx, store, testVertrauenschiffre()), bereich) { RedemptionPlanner { geplant += it } }
            .also { it.waitOnStart() }
    }

    private fun end() = areas.forEach { it.cancel() }.also { areas.clear() }

    private fun platte() = runBlocking { store.data.first() }

    @After
    fun zu() = end()

    @Test
    fun `a locked keystore during a server switch leaves no token from A behind`() {
        val a = "https://a.example"
        val b = "https://b.example"
        val erst = start(Tresor(0))
        runBlocking {
            erst.saveServerUrl(a)
            erst.saveAuthToken("tA")
        }
        assertFalse("Die Herkunft liegt nicht im Klartext", TokenAblage.TOKEN_ORIGIN in platte().asMap())
        assertTrue(TokenAblage.TOKEN_ORIGIN_SECRET in platte().asMap())
        assertEquals(NetworkPolicy.herkunft(a), runBlocking { erst.tokenStatus().herkunft })
        end()

        // Restart: the first four openings (startup) are locked, memory reports "".
        val gesperrt = start(Tresor(4))
        runBlocking {
            assertEquals("Der Anlauf meldet die Anmeldemaske", "", gesperrt.tokenJetzt())
            gesperrt.saveServerUrl(b)
        }
        val p = platte()
        assertFalse("Das Token von A liegt nach dem Wechsel noch da", TokenAblage.AUTH_TOKEN_ENC in p.asMap())
        assertFalse(TokenAblage.AUTH_TOKEN in p.asMap())
        assertFalse(TokenAblage.TOKEN_ORIGIN in p.asMap() || TokenAblage.TOKEN_ORIGIN_SECRET in p.asMap())
        val job = runBlocking { gesperrt.entwertungsauftrag() }
        assertTrue("Ein Auftrag für B trüge das Token von A dorthin: $job", job == null || job.serverUrl == a)
        assertEquals("A wird nachgeholt abgemeldet, mit dem Token von A", listOf(a to "ENC:tA"),
            geplant.map { it.serverUrl to it.tokenSecret })
        assertEquals(NetworkPolicy.herkunft(a), geplant.single().herkunft)
        end()

        // The keystore is back: no token of A comes back from disk.
        val offen = start(Tresor(0))
        assertEquals("", runBlocking { offen.tokenJetzt() })
        assertEquals(b, runBlocking { offen.serverUrlJetzt() })
    }

    @Test
    fun `a token of older versions is bound to the registered server at start`() {
        runBlocking {
            store.edit {
                it[TokenAblage.SERVER_URL] = "https://alt.example/brick"
                it[TokenAblage.AUTH_TOKEN_ENC] = "ENC:alt"
            }
        }
        val prefs = start(Tresor(0))
        val erwartet = NetworkPolicy.herkunft("https://alt.example/brick")
        assertTrue("Gebunden, und zwar verschlüsselt", TokenAblage.TOKEN_ORIGIN_SECRET in platte().asMap())
        assertFalse(TokenAblage.TOKEN_ORIGIN in platte().asMap())
        assertEquals(erwartet, prefs.tokenOriginState.value)
        assertEquals("alt", runBlocking { prefs.tokenJetzt() })
    }
}
