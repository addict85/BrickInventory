package ch.brickinventoryapp.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * The two keys of the device store: names of entries reveal nothing about the server,
 * and a value under the unlock key is „later“ when the device is locked, not „gone“.
 *
 * Counter-checks (kotlinc and JUnit locally):
 *   A  name() returns the binding itself → red „ein Name verraet den Server nicht …“;
 *      counter-checks/pin-name-in-plaintext.patch
 *   B  openDetail() fetches the key inside the check (locked becomes „gone“) → red
 *      „locked an entry is readable later, not gone“; counter-checks/detail-locked-as-missing.patch
 */
class TrustCipherTest {

    private val trust = ByteArray(32) { 1 }
    private val detailsKey = ByteArray(32) { 2 }
    private var locked = false
    private val cipher = TrustCipher(info = {
        if (locked) throw IOException("Keystore gerade nicht bereit")
        detailsKey.copyOf()
    }) { trust.copyOf() }

    @Test
    fun `a name does not reveal the server and stays the same`() {
        val name = cipher.name("brick.example.org:443")!!
        assertFalse(name, "brick" in name || "443" in name)
        assertEquals("Derselbe Server, derselbe Name", name, cipher.name("brick.example.org:443"))
        assertNotEquals(name, cipher.name("nas.local:8443"))
        assertNotEquals("another key, another name", name, TrustCipher { ByteArray(32) { 9 } }.name("brick.example.org:443"))
        assertTrue("usable as a key of a store: $name", name.all { it.isLetterOrDigit() || it == '-' || it == '_' })
        locked = true
        assertEquals("the trust key works even when locked", name, cipher.name("brick.example.org:443"))
    }

    @Test
    fun `locked an entry is readable later, not gone`() {
        val secret = cipher.encryptDetail("https://brick.example.org", "server_url")!!
        assertFalse(secret, "brick" in secret)
        locked = true
        assertEquals(VaultFinding.LockedState, cipher.openDetail(secret, "server_url"))
        assertNull("locked, nothing is stored", cipher.encryptDetail("x", "server_url"))
        locked = false
        assertEquals(VaultFinding.Readable("https://brick.example.org"), cipher.openDetail(secret, "server_url"))
    }

    @Test
    fun `an entry under a foreign name or key is gone`() {
        val secret = cipher.encryptDetail("anna", "username")!!
        assertEquals(VaultFinding.Gone, cipher.openDetail(secret, "server_url"))
        assertEquals(VaultFinding.Gone, TrustCipher { trust.copyOf() }.openDetail(secret, "username"))
        assertEquals(VaultFinding.Gone, cipher.openDetail("kein-base64-%%%", "username"))
        assertNull("a pin ciphertext is no statement", cipher.decrypt(secret, "username"))
    }
}
