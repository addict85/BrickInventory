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
 * Der Keystore-Tresor selbst, mit einem Schlüsselbund im Speicher statt des AndroidKeyStore:
 * Neue Geheimtexte tragen eine AAD, alte ohne bleiben lesbar und werden umgeschlüsselt; der
 * Altbestand legt keinen Schlüssel an, und nach dem Umschlüsseln ist sein Alias weg.
 *
 * Gegenproben (kotlinc und JUnit lokal):
 *   tresor-ohne-aad              verschluessle() ohne updateAAD → rot „ein neuer Geheimtext traegt
 *                                die AAD …“
 *   altbestand-legt-schluessel-an  schluessel() erzeugt auch im Altbestand → rot „der Altbestand
 *                                legt keinen Schluessel an …“
 *   ablage-alter-alias-bleibt    wrapNew() ohne forgetLegacyStock → rot „nach dem Umschluesseln
 *                                ist der alte Alias der Ablage weg …“
 */
class KeystoreLegacyStockTest {

    /** Wie der Keystore, aber im Speicher; merkt sich, welche Aliase je angelegt wurden. */
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

    /** Was der Ablageschlüssel geschrieben hat: ein Ergebnis des Laufs, kein Quelltext. */
    private fun abgelegt() = datei.readBytes().decodeToString()

    @After
    fun zu() {
        folder.deleteRecursively()
    }

    /** Ein Geheimtext, wie ihn Fassungen vor der AAD ablegten: Base64( IV ‖ Geheimtext ), ohne Präfix. */
    private fun alterCiphertext(alias: String, klartext: String): String {
        val k = bund.schluessel.getOrPut(alias) { KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }
        return Base64.getEncoder().encodeToString(c.iv + c.doFinal(klartext.toByteArray()))
    }

    @Test
    fun `ein neuer Geheimtext traegt die AAD, ein alter ohne bleibt lesbar und gilt als veraltet`() {
        val tresor = KeystoreTokenVault("t", bund = bund)
        val alt = alterCiphertext("t", "token-alt")
        assertEquals(Tresorbefund.Readable("token-alt"), tresor.oeffne(alt))
        assertTrue("Ohne AAD wird umgeschlüsselt", tresor.veraltet(alt))

        val neu = tresor.verschluessle("token-neu")
        assertFalse(tresor.veraltet(neu))
        assertEquals(Tresorbefund.Readable("token-neu"), tresor.oeffne(neu))
        // Präfix abgeschnitten: Liest der Tresor das als Altbestand ohne AAD, war keine gesetzt.
        assertEquals("Ohne Präfix gilt der neue Geheimtext nicht", Tresorbefund.Weg, tresor.oeffne(neu.substringAfter(":")))
    }

    @Test
    fun `der Altbestand legt keinen Schluessel an und meldet weg`() {
        val alt = KeystoreTokenVault("brickinventory_auth_token", readOnly = true, bund = bund)
        val geheim = KeystoreTokenVault("anderer", bund = bund).verschluessle("x").removePrefix("a1:")
        assertEquals(Tresorbefund.Weg, alt.oeffne(geheim))
        assertFalse("Kein neuer Schlüssel unter dem alten Alias: ${bund.angelegt}", "brickinventory_auth_token" in bund.angelegt)
        assertEquals(Tresorbefund.Weg, EntsperrVault(KeystoreTokenVault("neu", true, bund = bund), alt).oeffne(geheim))
        assertFalse("${bund.angelegt}", "brickinventory_auth_token" in bund.angelegt)
    }

    @Test
    fun `nach dem Umschluesseln ist der alte Alias der Ablage weg, der Schluessel bleibt derselbe`() {
        // Der Stand früherer Fassungen: Ablageschlüssel ohne Präfix und AAD unter dem Alias ohne Bedingung.
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
    fun `ein Geheimtext ohne AAD unter dem Entsperr-Schluessel wird ebenso umgeschluesselt`() {
        val hex = "cd".repeat(32)
        datei.writeText(UNLOCKED_PREFIX + alterCiphertext("e", hex))
        val tresor = EntsperrVault(KeystoreTokenVault("e", onlyUnlocked = true, bund = bund),
            KeystoreTokenVault("a", readOnly = true, bund = bund))
        assertTrue(tresor.veraltet(abgelegt()))
        assertArrayEquals(ByteArray(32) { 0xcd.toByte() }, Ablageschluessel(datei, tresor).fetch())
        assertTrue("Jetzt mit AAD: ${abgelegt()}", abgelegt().startsWith(UNLOCKED_PREFIX + "a1:"))
    }
}
