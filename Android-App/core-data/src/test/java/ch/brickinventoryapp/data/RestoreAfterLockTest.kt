package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.model.util.LockWipe
import ch.brickinventoryapp.security.DeviceLock
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Screen off wipes the token from the interceptor's mirror (TOKEN_WIPED). While the keystore stays
 * locked longer than readToken's start-up attempts, readToken reports "" once: "not yet", not
 * "signed out". Neither a restore nor the disk mirror may take that "" as the token, or every
 * request while locked goes out without one (401, session-expired hint).
 *
 * Both tests wait on counted vault answers instead of a time window, and the store under test is
 * started on a disk that already holds the token, so no mirror read is still in flight at the lock.
 *
 * Counter-checks (Robolectric, local, Nov 27, 2026):
 *   restoreAfterLock() back to `val token = authToken.first()` → red „a restore while the keystore
 *     is locked …“ (mirror was ""); counter-checks/restore-after-lock-takes-empty.patch
 *   token mirror reports readToken's "" as is (no LockedState marker) → red „a disk change read
 *     while locked …“ (mirror was ""); counter-checks/token-mirror-takes-locked-empty.patch
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RestoreAfterLockTest {

    /** Like the Keystore under setUnlockedDeviceRequired; counts LockedState answers per ciphertext. */
    private class LockableVault : TokenEncryption {
        @Volatile var locked = false
        val lockedAnswers = ConcurrentHashMap<String, AtomicInteger>()
        /** Disk reads counted at the moment of the n-th LockedState answer for a ciphertext. */
        val readsAtLocked = ConcurrentHashMap<Pair<String, Int>, Int>()
        var reads: () -> Int = { 0 }
        override fun encrypt(plaintext: String) = "ENC($plaintext)"
        override fun decrypt(saved: String) = saved.removePrefix("ENC(").removeSuffix(")")
        override fun open(saved: String): VaultFinding {
            if (!locked) return VaultFinding.Readable(decrypt(saved))
            val n = lockedAnswers.getOrPut(saved) { AtomicInteger() }.incrementAndGet()
            readsAtLocked[saved to n] = reads()
            return VaultFinding.LockedState
        }
        fun lockedCount(saved: String) = lockedAnswers[saved]?.get() ?: 0
    }

    /** Counts collections of `data`: the mirror reads the disk under its lock right before it sets. */
    private class CountingStore(private val inner: DataStore<Preferences>) : DataStore<Preferences> {
        val reads = AtomicInteger()
        override val data = flow { reads.incrementAndGet(); emitAll(inner.data) }
        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences) = inner.updateData(transform)
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()
    private val disk = PreferenceDataStoreFactory.create { File(ctx.filesDir, "restore-${System.nanoTime()}.preferences_pb") }
    private val store = CountingStore(disk)
    private val wipe = LockWipe()
    private val vault = LockableVault().also { v -> v.reads = { store.reads.get() } }

    @After
    fun tearDown() = areas.forEach { it.cancel() }

    private fun tokenStore(lockWipe: LockWipe): TokenStore {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenStore(store, vault, DevicesStore(ctx, disk, testTrustCipher()), scope, lockWipe,
            lock = DeviceLock { vault.locked })
    }

    /** Signs in with one store, then starts the store under test on that disk: its mirrors have read it. */
    private fun signedIn(): TokenStore {
        val writer = tokenStore(LockWipe())
        writer.waitOnStart()
        runBlocking { writer.saveServerUrl("https://brick.example"); writer.saveAuthToken("tok-a") }
        areas.removeAt(0).cancel()
        return tokenStore(wipe).also { it.waitOnStart(); waitFor(it, "tok-a") }
    }

    private fun waitFor(p: TokenStore, value: String) =
        runBlocking { withTimeout(10_000) { while (p.authTokenState.value != value) delay(10) } }

    private fun lockAndWipe(p: TokenStore) {
        vault.locked = true
        wipe.wipe()
        waitFor(p, TokenStore.TOKEN_WIPED)
    }

    private fun unlockBrings(p: TokenStore, token: String) {
        // ACTION_USER_PRESENT → LockWipe.restore().
        vault.locked = false
        wipe.restore()
        waitFor(p, token)
        assertEquals(token, runBlocking { p.tokenNow() })
    }

    @Test
    fun `a restore while the keystore is locked does not sign out, unlocking brings the token back`() {
        val p = signedIn()
        lockAndWipe(p)

        // A request while locked (ServerClient.token()). Five LockedState answers until readToken
        // reports "", the sixth is the restore's own check; then it has decided without writing.
        p.restoreAfterLock()
        runBlocking {
            withTimeout(15_000) {
                while (vault.lockedCount("ENC(tok-a)") < 6 && p.authTokenState.value != "") delay(10)
            }
        }
        assertEquals("locked, the mirror keeps the placeholder instead of reading as signed out",
            TokenStore.TOKEN_WIPED, p.authTokenState.value)

        unlockBrings(p, "tok-a")
    }

    @Test
    fun `a disk change read while locked keeps the placeholder, unlocking brings the new token`() {
        val p = signedIn()
        // A new token on disk just before the lock (sign-in, swap): the mirror reads it locked.
        vault.locked = true
        runBlocking { p.saveAuthToken("tok-b") }
        wipe.wipe()
        waitFor(p, TokenStore.TOKEN_WIPED)

        // The fifth LockedState answer makes readToken report; the mirror then reads the disk under
        // its lock before it sets. Once that read has started, swapping waits for the same lock.
        runBlocking {
            withTimeout(15_000) {
                while (vault.lockedCount("ENC(tok-b)") < 5) delay(10)
                val before = vault.readsAtLocked.getValue("ENC(tok-b)" to 5)
                while (store.reads.get() <= before) delay(10)
                p.replaceSwappedToken(TokenStatus("", null, -1), "unused", null)
            }
        }
        assertEquals("a locked read keeps the placeholder instead of reading as signed out",
            TokenStore.TOKEN_WIPED, p.authTokenState.value)

        unlockBrings(p, "tok-b")
    }
}
