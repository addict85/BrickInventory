package ch.brickinventoryapp.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.security.TrustCipher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.util.Base64

/**
 * Pins (TOFU) and the switch „trust user CAs“ lie encrypted in the mirror
 * of the DevicesStore; plaintext of older versions is taken over once and deleted.
 * What cannot be decrypted means „no pin“ or „switch off“ — the
 * user confirms anew, an uncheckable value never counts as trust. A restart is
 * a new instance on the same SharedPreferences.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   vertrauen-pin-klartext           rememberPin() additionally writes the plaintext → red
 *                                    “pin and switch do not lie in plaintext”
 *   vertrauen-unlesbar-erlaubt       userCaAllowed() takes an unreadable value as
 *                                    „on“ → red “a changed value does not count”
 *   vertrauen-ohne-bindung           Vertrauenschiffre does not bind the name → red
 *                                    “a ciphertext under a foreign name does not count”
 *   vertrauen-klartext-bleibt        the takeover does not delete the plaintext → red
 *                                    “plaintext is taken over once”
 *   vertrauen-marke-uebergangen      the marker is not checked → red “plaintext
 *                                    placed later does not count”
 *   vertrauen-fehler-als-klartext    rememberPin() stores plaintext when encryption
 *                                    fails → red “without a key nothing stays …”
 *   code-pin-ueber-alte-verbindung   holdBefore() does not call the listeners → red “a pin from the
 *                                    code applies only via a new connection”
 *   pin-namen-ohne-uebernahme        prepareBefore() without adoptPinNames() → red “a pin
 *                                    of an earlier version goes under a name …”
 *   pin-name-mit-host                pinEntry() appends host and port again → red “no
 *                                    entry names the server”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TrustEncryptedTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val mirror: SharedPreferences =
        ctx.getSharedPreferences(DevicesStore.DESIGN_MIRROR_FILE, Context.MODE_PRIVATE)
    private val host = "brick.example.org:443"
    private val fp = "sha256/AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK="

    @Before
    fun empty() = mirror.edit(commit = true) { clear() }

    /** As at app start: new instance, prepareBefore() before the first connection setup. */
    private fun start(cipher: TrustCipher = testTrustCipher()): DevicesStore {
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "vertrauen-${System.nanoTime()}.preferences_pb") }
        return DevicesStore(ctx, store, cipher).also { it.prepareBefore() }
    }

    private fun plaintextOnDisk(): List<String> =
        mirror.all.filter { (k, v) -> k == DevicesStore.USER_CA || k.startsWith(DevicesStore.PIN_PREFIX) || v == fp }
            .map { (k, v) -> "$k=$v" }

    @Test
    fun `pin and switch do not lie in plaintext and survive the restart`() {
        val g = start()
        g.rememberPin(host, fp)
        g.setUserCa(true)
        assertEquals("Pin and switch are not in plaintext", emptyList<String>(), plaintextOnDisk())
        val newValue = start()
        assertEquals(fp, newValue.pin(host))
        assertTrue(newValue.userCaAllowed())
        newValue.setUserCa(false)
        assertFalse("Off stays off", start().userCaAllowed())
    }

    @Test
    fun `a changed value does not count, not even with a foreign key`() {
        start().apply { rememberPin(host, fp); setUserCa(true) }
        assertNull("Foreign key: no pin", start(testTrustCipher(8)).pin(host))
        assertFalse("Foreign key: switch off", start(testTrustCipher(8)).userCaAllowed())
        val entry = start().pinEntry(host)!!
        mirror.edit(commit = true) {
            putString(DevicesStore.USER_CA_SECRET, flip(mirror.getString(DevicesStore.USER_CA_SECRET, null)!!))
            putString(entry, "kein-base64-%%%")
        }
        val g = start()
        assertFalse("a changed value does not count as „on“", g.userCaAllowed())
        assertNull("an unreadable pin is no pin — the user confirms anew", g.pin(host))
    }

    @Test
    fun `a ciphertext under a foreign name does not count`() {
        val other = "anderer.example.org:443"
        val g0 = start().apply { rememberPin(other, fp) }
        val secret = mirror.getString(g0.pinEntry(other)!!, null)!!
        mirror.edit(commit = true) {
            putString(g0.pinEntry(host)!!, secret)
            putString(DevicesStore.USER_CA_SECRET, secret)
        }
        val g = start()
        assertNull("Another server's pin does not count for this one", g.pin(host))
        assertFalse("A pin ciphertext does not switch on the user CAs", g.userCaAllowed())
        assertEquals(fp, g.pin(other))
    }

    @Test
    fun `plaintext is taken over once and deleted afterwards`() {
        mirror.edit(commit = true) {
            putBoolean(DevicesStore.USER_CA_FROM_APPLIED, true)
            putBoolean(DevicesStore.USER_CA, true)
            putString(DevicesStore.PIN_PREFIX + host, fp)
        }
        val g = start()
        assertEquals("The old pin still applies", fp, g.pin(host))
        assertTrue("The old switch still applies", g.userCaAllowed())
        assertEquals("plaintext is taken over once and deleted afterwards", emptyList<String>(), plaintextOnDisk())
        assertEquals(fp, start().pin(host))
    }

    @Test
    fun `plaintext placed later does not count and is deleted`() {
        start().rememberPin(host, fp)
        mirror.edit(commit = true) {
            putBoolean(DevicesStore.USER_CA, true)
            putString(DevicesStore.PIN_PREFIX + "boese.example.org:443", fp)
        }
        val g = start()
        assertFalse("plaintext put there later does not count", g.userCaAllowed())
        assertNull(g.pin("boese.example.org:443"))
        assertEquals(fp, g.pin(host))
        assertEquals(emptyList<String>(), plaintextOnDisk())
    }

    @Test
    fun `without a key nothing stays in plaintext and nothing counts as allowed`() {
        val broken = TrustCipher { throw IOException("Keystore gerade nicht bereit") }
        mirror.edit(commit = true) {
            putBoolean(DevicesStore.USER_CA_FROM_APPLIED, true)
            putBoolean(DevicesStore.USER_CA, true)
        }
        val g = start(broken)
        assertFalse("Plaintext not taken over does not count", g.userCaAllowed())
        g.setUserCa(true)
        assertFalse("An „on“ that cannot be encrypted is not stored", g.userCaAllowed())
        g.rememberPin(host, fp)
        assertEquals("Confirmed, the pin applies until the process ends", fp, g.pin(host))
        assertEquals("without a key nothing stays on disk in plaintext",
            listOf("${DevicesStore.USER_CA}=true"), plaintextOnDisk())
        assertTrue("With a key the leftover plaintext is taken over", start().userCaAllowed())
        assertNull("The unsecured pin does not survive the restart", start().pin(host))
    }

    @Test
    fun `no entry names the server`() {
        start().apply { rememberPin(host, fp); rememberPin("$host#blatt", fp) }
        val names = mirror.all.keys
        assertTrue("Pins are stored: $names", names.count { it.startsWith(DevicesStore.PIN_NAME_PREFIX) } == 2)
        assertFalse("A name reveals the server: $names", names.any { "example" in it || "443" in it })
    }

    @Test
    fun `a pin of an earlier version goes under a name without server and keeps applying`() {
        val g0 = start()
        g0.rememberPin(host, fp)
        val entry = g0.pinEntry(host)!!
        val secret = mirror.getString(entry, null)!!
        // This is how it lay in earlier versions: the same ciphertext, host and port in the name.
        mirror.edit(commit = true) { remove(entry); putString(DevicesStore.PIN_SECRET_PREFIX + host, secret) }
        val g = start()
        assertEquals(fp, g.pin(host))
        assertFalse("The old name is gone", mirror.contains(DevicesStore.PIN_SECRET_PREFIX + host))
        assertEquals(secret, mirror.getString(entry, null))
    }

    /** Flip a bit in the ciphertext: the Base64 stays valid, the GCM tag does not. */
    private fun flip(b64: String): String {
        val raw = Base64.getDecoder().decode(b64)
        raw[raw.size - 1] = (raw[raw.size - 1].toInt() xor 1).toByte()
        return Base64.getEncoder().encodeToString(raw)
    }

    /**
     * The server clients rebuild their TLS context on the signal and clear the
     * connection pool (di/ServerClient); without it the sign-in would run via an already
     * open connection, and the fingerprint from the code would never be checked.
     */
    @Test
    fun `a pin from the code applies only via a new connection`() {
        val g = start()
        var newValue = 0
        g.onUserCaSwitch { newValue++ }
        g.holdBefore(host, fp)
        assertEquals(1, newValue)
        assertTrue(g.fromCode(host))
        assertEquals(fp, g.pin(host))
        g.rememberPin(host, fp)
        assertFalse("Remembered, it no longer counts as a pin from the code", g.fromCode(host))
    }
}
