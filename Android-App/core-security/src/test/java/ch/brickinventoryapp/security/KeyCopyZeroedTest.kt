package ch.brickinventoryapp.security

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Every raw key copy that leaves StoreKey or a key provider is zeroed once the JCE object holds
 * its own clone, and the cached key stays usable for the next derivation.
 *
 * Counter-checks (patches under counter-checks/, measured with tools/counter-checks.py):
 *   store-key-copy-not-zeroed     `key.fill(0)` in derive() removed → red “the copy handed to the
 *                                 derivation …”
 *   store-cipher-key-not-zeroed   `raw.fill(0)` in StoreCipher.spec() removed → red “the cipher
 *                                 zeroes …”
 *   trust-name-key-not-zeroed     the trust key not zeroed in TrustCipher.name() → red “an entry
 *                                 name zeroes …”
 */
class KeyCopyZeroedTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-zeroed-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun tearDown() {
        folder.deleteRecursively()
    }

    private object PlainVault : TokenEncryption {
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String) = saved
    }

    private fun zero(key: ByteArray) = key.all { it == 0.toByte() }

    private fun hmac(key: ByteArray, text: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(text.toByteArray(Charsets.UTF_8))
    }

    @Test
    fun `the copy handed to the derivation is zeroed, the result is the HMAC under the key`() {
        val store = StoreKey(File(folder, "store.key"), PlainVault)
        val copy = store.fetch()
        val expected = hmac(copy.copyOf(), "bilder")
        assertTrue("fetch() hands out the key, not zeros", !zero(copy))

        assertArrayEquals(expected, derive(copy, "bilder"))
        assertTrue("the raw copy still holds the master key", zero(copy))
        assertArrayEquals("the cached key survives: forTarget derives the same again", expected, store.forTarget("bilder"))
        assertArrayEquals(expected, store.forTarget("bilder"))
    }

    @Test
    fun `the cipher zeroes every key it was handed, and still decrypts`() {
        val handed = mutableListOf<ByteArray>()
        val cipher = StoreCipher { ByteArray(32) { 4 }.also { handed += it } }
        val secret = cipher.encrypt("Kaufpreis 499.99".toByteArray(), "antworten/a")
        assertEquals("Kaufpreis 499.99", cipher.decrypt(secret, "antworten/a")?.toString(Charsets.UTF_8))
        assertEquals("encrypt and decrypt each took one key", 2, handed.size)
        assertTrue("a raw key copy was left on the heap", handed.all(::zero))
    }

    @Test
    fun `an entry name zeroes the trust key and its derived name key`() {
        val handed = mutableListOf<ByteArray>()
        val cipher = TrustCipher { ByteArray(32) { 1 }.also { handed += it } }
        val name = cipher.name("brick.example.org:443")
        assertNotNull(name)
        assertEquals("the same key, the same name", name, cipher.name("brick.example.org:443"))
        assertTrue("a raw trust key was left on the heap", handed.isNotEmpty() && handed.all(::zero))
        val expected = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(hmac(hmac(ByteArray(32) { 1 }, "namen"), "brick.example.org:443")).take(22)
        assertEquals(expected, name)
    }
}
