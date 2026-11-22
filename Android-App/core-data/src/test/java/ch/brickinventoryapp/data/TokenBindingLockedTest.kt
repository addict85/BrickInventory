package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.testTrustCipher
import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
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
 * Real TokenStore on Robolectric, a restart is a new instance.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   wechsel-nach-speicher        saveServerUrl decides via tokenNow() again →
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
    private val scheduled = Collections.synchronizedList(mutableListOf<RedemptionJob>())

    /** The first [lock] openings answer „locked“, afterwards the keystore is back. */
    private class Vault(lock: Int) : TokenEncryption {
        private val rest = AtomicInteger(lock)
        override fun encrypt(plaintext: String) = "ENC:$plaintext"
        override fun decrypt(saved: String) = saved.removePrefix("ENC:")
        override fun open(saved: String): VaultFinding =
            if (rest.getAndDecrement() > 0) VaultFinding.LockedState else VaultFinding.Readable(decrypt(saved))
    }

    /** One file per test; DataStore allows only one instance per file in the process. */
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "bindung-${System.nanoTime()}.preferences_pb") }

    /** Ein Prozessstart: neue Instanz, eigener Bereich, dieselbe Platte. */
    private fun start(vault: TokenEncryption): TokenStore {
        val area = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenStore(store, vault, DevicesStore(ctx, store, testTrustCipher()), area) { RedemptionPlanner { scheduled += it } }
            .also { it.waitOnStart() }
    }

    private fun end() = areas.forEach { it.cancel() }.also { areas.clear() }

    private fun plate() = runBlocking { store.data.first() }

    @After
    fun tearDown() = end()

    @Test
    fun `a locked keystore during a server switch leaves no token from A behind`() {
        val a = "https://a.example"
        val b = "https://b.example"
        val first = start(Vault(0))
        runBlocking {
            first.saveServerUrl(a)
            first.saveAuthToken("tA")
        }
        assertFalse("Die Herkunft liegt nicht im Klartext", TokenStore.TOKEN_ORIGIN in plate().asMap())
        assertTrue(TokenStore.TOKEN_ORIGIN_SECRET in plate().asMap())
        assertEquals(NetworkPolicy.origin(a), runBlocking { first.tokenStatus().origin })
        end()

        // Restart: the first four openings (startup) are locked, memory reports "".
        val locked = start(Vault(4))
        runBlocking {
            assertEquals("Der Anlauf meldet die Anmeldemaske", "", locked.tokenNow())
            locked.saveServerUrl(b)
        }
        val p = plate()
        assertFalse("Das Token von A liegt nach dem Wechsel noch da", TokenStore.AUTH_TOKEN_ENC in p.asMap())
        assertFalse(TokenStore.AUTH_TOKEN in p.asMap())
        assertFalse(TokenStore.TOKEN_ORIGIN in p.asMap() || TokenStore.TOKEN_ORIGIN_SECRET in p.asMap())
        val job = runBlocking { locked.redemptionJob() }
        assertTrue("Ein Auftrag für B trüge das Token von A dorthin: $job", job == null || job.serverUrl == a)
        assertEquals("A wird nachgeholt abgemeldet, mit dem Token von A", listOf(a to "ENC:tA"),
            scheduled.map { it.serverUrl to it.tokenSecret })
        assertEquals(NetworkPolicy.origin(a), scheduled.single().origin)
        end()

        // The keystore is back: no token of A comes back from disk.
        val open = start(Vault(0))
        assertEquals("", runBlocking { open.tokenNow() })
        assertEquals(b, runBlocking { open.serverUrlNow() })
    }

    @Test
    fun `a token of older versions is bound to the registered server at start`() {
        runBlocking {
            store.edit {
                it[TokenStore.SERVER_URL] = "https://alt.example/brick"
                it[TokenStore.AUTH_TOKEN_ENC] = "ENC:alt"
            }
        }
        val prefs = start(Vault(0))
        val expected = NetworkPolicy.origin("https://alt.example/brick")
        assertTrue("Gebunden, und zwar verschlüsselt", TokenStore.TOKEN_ORIGIN_SECRET in plate().asMap())
        assertFalse(TokenStore.TOKEN_ORIGIN in plate().asMap())
        assertEquals(expected, prefs.tokenOriginState.value)
        assertEquals("alt", runBlocking { prefs.tokenNow() })
    }
}
