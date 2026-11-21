package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.Tresorbefund
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * Local stores lie encrypted: widget and preview with AES-GCM, the
 * stock with SQLCipher; the shared key only wrapped by the keystore. Here
 * a dummy stands in for the keystore that visibly changes the plaintext;
 * SQLCipher itself runs only on the device.
 *
 * Counter-checks:
 *   B  Ablageschluessel.hole() creates a new key on Gesperrt (as on
 *      Weg) → red “a locked keystore does not replace the key”
 *   C  Ablageschluessel.fuer() returns the shared key instead of a
 *      derived one → red “the key is created once …” and “plaintext
 *      and foreign data do not count” (widget and cache shared a key)
 *   D  in StoreCipher both `updateAAD(…)` struck → red “a
 *      file under a foreign name does not count”; gegenproben/ablage-ohne-bindung.patch
 *   F in erneuere() `bekannt = null` struck →
 *      red “after renewal everything old is unreadable …”
 */
class StoreEncryptionTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-ablage-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun zu() {
        folder.deleteRecursively()
    }

    /** Like the keystore: changes the text reversibly; [situation] controls what oeffne() reports. */
    private class Tresor : TokenEncryption {
        var situation: Tresorbefund? = null
        override fun verschluessle(klartext: String) = "umhuellt:" + klartext.reversed()
        override fun entschluessle(gespeichert: String) = gespeichert.removePrefix("umhuellt:").reversed()
        override fun oeffne(gespeichert: String): Tresorbefund = situation ?: Tresorbefund.Readable(entschluessle(gespeichert))
    }

    private val tresor = Tresor()
    private val datei = File(folder, "ablage.schluessel")

    @Test
    fun `the key is created once and lies only wrapped`() {
        val erster = Ablageschluessel(datei, tresor)
        val k = erster.fetch()
        assertEquals(32, k.size)
        assertTrue(erster.newCreated)
        assertTrue("Auf der Platte nur umhüllt", datei.readText().startsWith("umhuellt:"))
        val zweiter = Ablageschluessel(datei, tresor)
        assertArrayEquals("Nach dem Neustart derselbe", k, zweiter.fetch())
        assertFalse(zweiter.newCreated)
        assertNotEquals("Je Zweck ein eigener", zweiter.fuer("bestand.db").toList(), zweiter.fuer("antworten").toList())
    }

    @Test
    fun `after renewal everything old is unreadable, even after a restart`() {
        val k = Ablageschluessel(datei, tresor)
        var closed = 0
        k.beforeRenewal { closed++ }
        val alt = k.fetch().copyOf()
        val geheim = StoreCipher { k.fuer("antworten") }.verschluessle("Kaufpreis 499.99".toByteArray(), "a")
        k.renew()
        assertEquals("Wer den Schlüssel hält, schliesst vorher", 1, closed)
        assertNotEquals(alt.toList(), k.fetch().toList())
        assertTrue("Der neue Schlüssel ist als neu gemeldet", k.newCreated)
        assertNull(StoreCipher { k.fuer("antworten") }.entschluessle(geheim, "a"))
        assertNull("Auch die Platte hat nur den neuen",
            StoreCipher { Ablageschluessel(datei, tresor).fuer("antworten") }.entschluessle(geheim, "a"))
    }

    @Test
    fun `a locked keystore does not replace the key`() {
        Ablageschluessel(datei, tresor).fetch()
        val vorher = datei.readText()
        tresor.situation = Tresorbefund.Gesperrt
        try {
            Ablageschluessel(datei, tresor).fetch()
            fail("Gesperrt muss scheitern, nicht still einen neuen Schlüssel anlegen")
        } catch (_: IOException) {
        }
        assertEquals(vorher, datei.readText())
        tresor.situation = Tresorbefund.Weg
        val neu = Ablageschluessel(datei, tresor)
        neu.fetch()
        assertTrue("Weg heisst: neu anlegen und es sagen", neu.newCreated)
        assertNotEquals(vorher, datei.readText())
    }

    @Test
    fun `plaintext and foreign data do not count`() {
        val k = Ablageschluessel(datei, tresor)
        val cipher = StoreCipher { k.fuer("antworten") }
        val geheim = cipher.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertEquals("Kaufpreis 499.99", cipher.entschluessle(geheim, "antworten/a/sets.json")!!.toString(Charsets.UTF_8))
        assertNull("Klartext-Altbestand", cipher.entschluessle("""{"preis":499.99}""".toByteArray(), "antworten/a/sets.json"))
        assertNull("Anderer Schlüssel", StoreCipher { k.fuer("widget") }.entschluessle(geheim, "antworten/a/sets.json"))
        geheim[geheim.size - 1] = (geheim[geheim.size - 1] + 1).toByte()
        assertNull("Verändert", cipher.entschluessle(geheim, "antworten/a/sets.json"))
    }

    @Test
    fun `a file under a foreign name does not count`() {
        val k = Ablageschluessel(datei, tresor)
        val cipher = StoreCipher { k.fuer("antworten") }
        val geheim = cipher.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertNull("Anderer Dateiname", cipher.entschluessle(geheim, "antworten/a/finanzen.json"))
        assertNull("Anderes Fach", cipher.entschluessle(geheim, "antworten/b/sets.json"))
    }
}
