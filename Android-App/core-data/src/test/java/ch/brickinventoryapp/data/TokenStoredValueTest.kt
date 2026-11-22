package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.testing.testTrustCipher
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * The guard sees new token and new address BEFORE the first request goes out:
 * the TokenStore sets the memory value before the disk write, and a new
 * process gets both refilled from the DataStore. Executed with a DataStore
 * that halts every write until the test releases it.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   token-nach-der-schreibung    _authTokenState set only after dataStore.edit → red “token and address …”
 *   adresse-nach-der-schreibung  _serverUrlState set only after dataStore.edit → red, the same test
 *   token-ohne-nachlauf          the mirror for _authTokenState removed → red “a new process …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenStoredValueTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val area = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val file = File(ctx.filesDir, "token-${System.nanoTime()}.preferences_pb")
    private val real = PreferenceDataStoreFactory.create(scope = area) { file }
    private val device = DevicesStore(ctx,
        PreferenceDataStoreFactory.create { File(ctx.filesDir, "geraet-${System.nanoTime()}.preferences_pb") },
        testTrustCipher())

    /** Robolectric has no AndroidKeyStore; wrapping here is only for show. */
    private object PlainVault : TokenEncryption {
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String) = saved
    }

    /** Halts every write as long as [gate] is set; [waiting] counts the halted ones. */
    private class Hesitant(private val real: DataStore<Preferences>) : DataStore<Preferences> {
        @Volatile var gate: CompletableDeferred<Unit>? = null
        val waiting = AtomicInteger()
        override val data: Flow<Preferences> = real.data
        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences {
            gate?.let { waiting.incrementAndGet(); it.await() }
            return real.updateData(transform)
        }
    }

    @After
    fun tearDown() { area.cancel() }

    /** Starts [write], halts it at the disk and returns the memory value at that moment. */
    private fun duringTheSpelling(store: Hesitant, write: suspend () -> Unit, read: () -> String?): String? = runBlocking {
        val gate = CompletableDeferred<Unit>()
        store.gate = gate
        val before = store.waiting.get()
        val jobRun = area.launch { write() }
        withTimeout(5_000) { while (store.waiting.get() == before) delay(5) }
        val seen = read()
        store.gate = null
        gate.complete(Unit)
        jobRun.join()
        seen
    }

    @Test
    fun `token and address apply already while writing to disk`() {
        val store = Hesitant(real)
        val tokenStore = TokenStore(store, PlainVault, device, area).also { it.waitOnStart() }
        val address = "https://brick.example"
        assertEquals("Die Adresse folgt erst der Platte", address,
            duringTheSpelling(store, { tokenStore.saveServerUrl(address) }) { tokenStore.serverUrlState.value })
        assertEquals("Der Token folgt erst der Platte", "token-marco",
            duringTheSpelling(store, { tokenStore.saveAuthToken("token-marco") }) { tokenStore.authTokenState.value })
    }

    @Test
    fun `a new process gets token and address from the DataStore`() = runBlocking {
        val first = TokenStore(real, PlainVault, device, area).also { it.waitOnStart() }
        first.saveServerUrl("https://brick.example")
        first.saveAuthToken("token-marco")

        val newValue = TokenStore(real, PlainVault, device, area).also { it.waitOnStart() }
        assertEquals("https://brick.example", newValue.serverUrlState.value)
        assertEquals("token-marco", newValue.authTokenState.value)
    }
}
