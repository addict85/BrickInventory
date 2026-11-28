package ch.brickinventoryapp.security

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The Keystore vault itself, with a key bundle in memory instead of the AndroidKeyStore:
 * new ciphertexts carry an AAD, old ones without stay readable and get re-encrypted; the
 * legacy path creates no key, and after re-encrypting its alias is gone.
 *
 * Counter-checks (kotlinc and JUnit locally):
 *   vault-without-aad              encrypt() without updateAAD → red „ein neuer Geheimtext traegt die AAD …“
 *   legacy-data-creates-key  key() also creates one in the legacy path → red „der Altbestand legt keinen Schluessel an …“
 *   store-old-alias-stays    wrapNew() without forgetLegacyStock → red „nach dem Umschluesseln ist der alte Alias der Ablage weg …“
 */
class KeystoreLegacyStockTest {

    /** Like the Keystore, but in memory; remembers which aliases were ever created. */
    private class Bund : Keychain {
        val key = mutableMapOf<String, SecretKey>()
        val created = mutableListOf<String>()
        override fun fetch(alias: String) = key[alias]
        override fun generate(alias: String, onlyUnlocked: Boolean): SecretKey =
            KeyGenerator.getInstance("AES").apply { init(256) }.generateKey().also { key[alias] = it; created += alias }
        override fun delete(alias: String) { key.remove(alias) }
    }

    private val bund = Bund()
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-altbestand-${System.nanoTime()}").apply { mkdirs() }

    private val file = File(folder, "ablage.schluessel")

    /** What StoreKey wrote: a result of the run, not source code. */
    private fun stored() = file.readBytes().decodeToString()

    @After
    fun tearDown() {
        folder.deleteRecursively()
    }

    /** A ciphertext as versions before the AAD stored it: Base64( IV ‖ ciphertext ), without a prefix. */
    private fun oldCiphertext(alias: String, plaintext: String): String {
        val k = bund.key.getOrPut(alias) { KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }
        return Base64.getEncoder().encodeToString(c.iv + c.doFinal(plaintext.toByteArray()))
    }

    @Test
    fun `a new ciphertext carries the AAD, an old one without stays readable and counts as outdated`() {
        val vault = KeystoreTokenVault("t", bund = bund)
        val old = oldCiphertext("t", "token-alt")
        assertEquals(VaultFinding.Readable("token-alt"), vault.open(old))
        assertTrue("without AAD it is re-encrypted", vault.stale(old))

        val newValue = vault.encrypt("token-neu")
        assertFalse(vault.stale(newValue))
        assertEquals(VaultFinding.Readable("token-neu"), vault.open(newValue))
        // Prefix stripped off: if the vault reads this as legacy data without AAD, none had been set.
        assertEquals("without a prefix the new ciphertext does not count", VaultFinding.Gone, vault.open(newValue.substringAfter(":")))
    }

    @Test
    fun `the legacy stock creates no key and reports gone`() {
        val old = KeystoreTokenVault("brickinventory_auth_token", readOnly = true, bund = bund)
        val secret = KeystoreTokenVault("anderer", bund = bund).encrypt("x").removePrefix("a1:")
        assertEquals(VaultFinding.Gone, old.open(secret))
        assertFalse("no new key under the old alias: ${bund.created}", "brickinventory_auth_token" in bund.created)
        assertEquals(VaultFinding.Gone, UnlockVault(KeystoreTokenVault("neu", true, bund = bund), old).open(secret))
        assertFalse("${bund.created}", "brickinventory_auth_token" in bund.created)
    }

    @Test
    fun `after rekeying the old alias of the store is gone, the key stays the same`() {
        // The state of earlier versions: store key without a prefix and AAD, under the alias without a condition.
        val hex = "ab".repeat(32)
        file.writeText(oldCiphertext("brickinventory_ablage", hex))
        val vault = UnlockVault(
            KeystoreTokenVault("brickinventory_ablage_entsperrt", onlyUnlocked = true, bund = bund),
            KeystoreTokenVault("brickinventory_ablage", readOnly = true, bund = bund),
        )
        assertArrayEquals("the same key", ByteArray(32) { 0xab.toByte() }, StoreKey(file, vault).fetch())
        assertFalse("re-encrypted: ${stored()}", vault.stale(stored()))
        assertFalse("the old alias is gone: ${bund.key.keys}", "brickinventory_ablage" in bund.key)
        assertArrayEquals("readable after the restart", ByteArray(32) { 0xab.toByte() }, StoreKey(file, vault).fetch())
    }

    @Test
    fun `a ciphertext without AAD under the unlock key is rekeyed as well`() {
        val hex = "cd".repeat(32)
        file.writeText(UNLOCKED_PREFIX + oldCiphertext("e", hex))
        val vault = UnlockVault(KeystoreTokenVault("e", onlyUnlocked = true, bund = bund),
            KeystoreTokenVault("a", readOnly = true, bund = bund))
        assertTrue(vault.stale(stored()))
        assertArrayEquals(ByteArray(32) { 0xcd.toByte() }, StoreKey(file, vault).fetch())
        assertTrue("now with AAD: ${stored()}", stored().startsWith(UNLOCKED_PREFIX + "a1:"))
    }
}
