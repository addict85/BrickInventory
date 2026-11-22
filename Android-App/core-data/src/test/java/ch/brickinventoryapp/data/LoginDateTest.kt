package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.model.util.LockWipe
import ch.brickinventoryapp.security.TokenEncryption
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The sign-in date decides when the app signs itself out. It lies sealed and bound to the
 * token: deleting, editing or copying it from another sign-in counts as expired instead of
 * restarting the clock. A swap carries the date over. Locked, the token leaves the mirror.
 *
 * Counter-checks (Robolectric, local):
 *   A  in loginExpired() `LoginStatus.Missing -> false` → red „a deleted date …“, „a seal of another sign-in …“ and „a plaintext date …“ (after the transition)
 *   B  in loggedInFrom() the tag comparison removed (`it.size == 2`) → red „a seal of another sign-in …“
 *   C  writeToken() without previousToken (date not carried over) → red „a swap keeps the date …“
 *   D  in loggedInFrom() `minOf(old, now)` → `old` → red „a plaintext date of older versions …“
 *   E  wipeTokenMirror() empty → red „locked the token leaves the mirror …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LoginDateTest {

    private object Plain : TokenEncryption {
        override fun encrypt(plaintext: String) = "ENC($plaintext)"
        override fun decrypt(saved: String) = saved.removePrefix("ENC(").removeSuffix(")")
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "datum-${System.nanoTime()}.preferences_pb") }
    private val wipe = LockWipe()
    private val day = 24L * 60 * 60 * 1000

    private fun start(): TokenStore {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenStore(store, Plain, DevicesStore(ctx, store, testTrustCipher()), scope, wipe).also { it.waitOnStart() }
    }

    private fun signedIn(token: String = "tok-a"): TokenStore = start().also {
        runBlocking { it.saveServerUrl("https://brick.example"); it.saveAuthToken(token) }
    }

    private fun disk() = runBlocking { store.data.first() }

    @After
    fun tearDown() = areas.forEach { it.cancel() }

    @Test
    fun `a fresh sign-in counts 90 days and lies sealed`() {
        val now = System.currentTimeMillis()
        val p = signedIn()
        assertFalse(runBlocking { p.loginExpired(now) })
        assertFalse(runBlocking { p.loginExpiresSoon(now) })
        assertTrue(runBlocking { p.loginExpiresSoon(now + 85 * day) })
        assertTrue(runBlocking { p.loginExpired(now + 91 * day) })
        assertNull("No plaintext date anymore", disk()[TokenStore.SIGNED_IN_AT])
        val sealed = disk()[TokenStore.SIGNED_IN_SECRET]!!
        assertFalse("The date is not readable", (now / 100_000).toString() in sealed)
    }

    @Test
    fun `a deleted date counts as expired instead of restarting the clock`() {
        val p = signedIn()
        runBlocking { store.edit { it.remove(TokenStore.SIGNED_IN_SECRET) } }
        assertTrue(runBlocking { p.loginExpired(System.currentTimeMillis()) })
    }

    @Test
    fun `a seal of another sign-in does not count for this token`() {
        val p = signedIn("tok-a")
        val other = disk()[TokenStore.SIGNED_IN_SECRET]!!
        runBlocking { p.saveAuthToken("tok-b") }
        runBlocking { store.edit { it[TokenStore.SIGNED_IN_SECRET] = other } }
        assertTrue(runBlocking { p.loginExpired(System.currentTimeMillis()) })
    }

    @Test
    fun `a swap keeps the date of the sign-in`() {
        val now = System.currentTimeMillis()
        val p = signedIn()
        val before = runBlocking { p.tokenStatus() }
        assertTrue(runBlocking { p.replaceSwappedToken(before, "tok-neu", before.origin) })
        assertEquals("tok-neu", runBlocking { p.tokenNow() })
        assertFalse(runBlocking { p.loginExpired(now + 89 * day) })
        assertTrue("The switch extends nothing", runBlocking { p.loginExpired(now + 91 * day) })
    }

    @Test
    fun `a plaintext date of older versions counts at most from now and is sealed`() {
        val now = System.currentTimeMillis()
        val p = signedIn()
        runBlocking {
            store.edit { it.remove(TokenStore.SIGNED_IN_SECRET); it[TokenStore.SIGNED_IN_AT] = now + 365 * day }
        }
        val legacyNow = minOf(now, TokenStore.LEGACY_DATE_UNTIL - day)
        assertFalse(runBlocking { p.loginExpired(legacyNow) })
        assertTrue("A date in the future extends nothing", runBlocking { p.loginExpired(legacyNow + 91 * day) })
        assertNull(disk()[TokenStore.SIGNED_IN_AT])
        runBlocking { store.edit { it.remove(TokenStore.SIGNED_IN_SECRET); it[TokenStore.SIGNED_IN_AT] = now } }
        assertTrue("After the transition period only the seal counts",
            runBlocking { p.loginExpired(TokenStore.LEGACY_DATE_UNTIL + 1) })
    }

    @Test
    fun `locked the token leaves the mirror, unlocked it comes back`() {
        val p = signedIn()
        wipe.wipe()
        runBlocking { withTimeout(5_000) { while (p.authTokenState.value != TokenStore.TOKEN_WIPED) delay(10) } }
        assertTrue("Signed in stays signed in", p.authTokenState.value!!.isNotBlank())
        assertEquals("Whoever asks suspended reads from disk", "tok-a", runBlocking { p.tokenNow() })
        wipe.restore()
        runBlocking { withTimeout(5_000) { while (p.authTokenState.value != "tok-a") delay(10) } }
    }
}
