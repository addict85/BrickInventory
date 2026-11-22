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
 *   tresor-ohne-aad              verschluessle() without updateAAD → red „ein neuer Geheimtext traegt
 *                                die AAD …“
 *   altbestand-legt-schluessel-an  schluessel() also creates one in the legacy path → red „der Altbestand
 *                                legt keinen Schluessel an …“
 *   ablage-alter-alias-bleibt    wrapNew() without forgetLegacyStock → red „nach dem Umschluesseln
 *                                ist der alte Alias der Ablage weg …“
 */
class KeystoreLegacyStockTest {

    /** Like the Keystore, but in memory; remembers which aliases were ever created. */
    private class Bund : Keychain {
        val schluessel = mutableMapOf<String, SecretKey>()
        val angelegt = mutableListOf<String>()
        override fun fetch(alias: String) = schluessel[alias]
        override fun erzeuge(alias: String, onlyUnlocked: Boolean): SecretKey =
            KeyGenerator.getInstance("AES").apply { init(256) }.generateKey().also { schluessel[alias] = it; angelegt += alias }
        override fun delete(alias: String) { schluessel.remove(alias) }
    }

    private val bund = Bund()
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-altbestand-${System.nanoTime()}").apply { mkdirs() }

    private val datei = File(folder, "ablage.schluessel")

    /** What Ablageschluessel wrote: a result of the run, not source code. */
    private fun abgelegt() = datei.readBytes().decodeToString()

    @After
    fun zu() {
        folder.deleteRecursively()
    }

    /** A ciphertext as versions before the AAD stored it: Base64( IV ‖ ciphertext ), without a prefix. */
    private fun alterCiphertext(alias: String, klartext: String): String {
        val k = bund.schluessel.getOrPut(alias) { KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }
        return Base64.getEncoder().encodeToString(c.iv + c.doFinal(klartext.toByteArray()))
    }

    @Test
    fun `a new ciphertext carries the AAD, an old one without stays readable and counts as outdated`() {
        val tresor = KeystoreTokenVault("t", bund = bund)
        val alt = alterCiphertext("t", "token-alt")
        assertEquals(Tresorbefund.Readable("token-alt"), tresor.oeffne(alt))
        assertTrue("Ohne AAD wird umgeschlüsselt", tresor.veraltet(alt))

        val neu = tresor.verschluessle("token-neu")
        assertFalse(tresor.veraltet(neu))
        assertEquals(Tresorbefund.Readable("token-neu"), tresor.oeffne(neu))
        // Prefix stripped off: if the vault reads this as legacy data without AAD, none had been set.
        assertEquals("Ohne Präfix gilt der neue Geheimtext nicht", Tresorbefund.Weg, tresor.oeffne(neu.substringAfter(":")))
    }

    @Test
    fun `the legacy stock creates no key and reports gone`() {
        val alt = KeystoreTokenVault("brickinventory_auth_token", readOnly = true, bund = bund)
        val geheim = KeystoreTokenVault("anderer", bund = bund).verschluessle("x").removePrefix("a1:")
        assertEquals(Tresorbefund.Weg, alt.oeffne(geheim))
        assertFalse("Kein neuer Schlüssel unter dem alten Alias: ${bund.angelegt}", "brickinventory_auth_token" in bund.angelegt)
        assertEquals(Tresorbefund.Weg, EntsperrVault(KeystoreTokenVault("neu", true, bund = bund), alt).oeffne(geheim))
        assertFalse("${bund.angelegt}", "brickinventory_auth_token" in bund.angelegt)
    }

    @Test
    fun `after rekeying the old alias of the store is gone, the key stays the same`() {
        // The state of earlier versions: store key without a prefix and AAD, under the alias without a condition.
        val hex = "ab".repeat(32)
        datei.writeText(alterCiphertext("brickinventory_ablage", hex))
        val tresor = EntsperrVault(
            KeystoreTokenVault("brickinventory_ablage_entsperrt", onlyUnlocked = true, bund = bund),
            KeystoreTokenVault("brickinventory_ablage", readOnly = true, bund = bund),
        )
        assertArrayEquals("Derselbe Schlüssel", ByteArray(32) { 0xab.toByte() }, Ablageschluessel(datei, tresor).fetch())
        assertFalse("Umgeschlüsselt: ${abgelegt()}", tresor.veraltet(abgelegt()))
        assertFalse("Der alte Alias ist weg: ${bund.schluessel.keys}", "brickinventory_ablage" in bund.schluessel)
        assertArrayEquals("Nach dem Neustart lesbar", ByteArray(32) { 0xab.toByte() }, Ablageschluessel(datei, tresor).fetch())
    }

    @Test
    fun `a ciphertext without AAD under the unlock key is rekeyed as well`() {
        val hex = "cd".repeat(32)
        datei.writeText(UNLOCKED_PREFIX + alterCiphertext("e", hex))
        val tresor = EntsperrVault(KeystoreTokenVault("e", onlyUnlocked = true, bund = bund),
            KeystoreTokenVault("a", readOnly = true, bund = bund))
        assertTrue(tresor.veraltet(abgelegt()))
        assertArrayEquals(ByteArray(32) { 0xcd.toByte() }, Ablageschluessel(datei, tresor).fetch())
        assertTrue("Jetzt mit AAD: ${abgelegt()}", abgelegt().startsWith(UNLOCKED_PREFIX + "a1:"))
    }
}
