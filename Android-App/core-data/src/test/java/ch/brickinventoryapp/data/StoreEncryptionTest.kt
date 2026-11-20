package ch.brickinventoryapp.data

import ch.brickinventoryapp.sicherheit.StoreCipher
import ch.brickinventoryapp.sicherheit.Ablageschluessel
import ch.brickinventoryapp.sicherheit.TokenEncryption
import ch.brickinventoryapp.sicherheit.Tresorbefund
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
 * Lokale Ablagen liegen verschlüsselt: Widget und Vorschau mit AES-GCM, der
 * Bestand mit SQLCipher; der gemeinsame Schlüssel nur vom Keystore umhüllt. Hier
 * steht eine Attrappe für den Keystore, die den Klartext sichtbar verändert;
 * SQLCipher selbst läuft nur auf dem Gerät.
 *
 * Gegenproben:
 *   B  Ablageschluessel.hole() legt bei Gesperrt einen neuen Schlüssel an (wie bei
 *      Weg) → rot „ein gesperrter Keystore ersetzt den Schluessel nicht“
 *   C  Ablageschluessel.fuer() gibt den gemeinsamen Schlüssel statt eines
 *      abgeleiteten zurück → rot „der Schluessel entsteht einmal …“ und „Klartext
 *      und fremde Daten gelten nicht“ (Widget und Cache teilten einen Schlüssel)
 *   D  in StoreCipher beide `updateAAD(…)` gestrichen → rot „eine
 *      Datei unter fremdem Namen gilt nicht“; gegenproben/ablage-ohne-bindung.patch
 *   F in erneuere() `bekannt = null` gestrichen →
 *      rot „nach dem Erneuern ist alles Alte unlesbar …“
 */
class StoreEncryptionTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-ablage-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun zu() {
        folder.deleteRecursively()
    }

    /** Wie der Keystore: verändert den Text umkehrbar; [situation] steuert, was oeffne() meldet. */
    private class Tresor : TokenEncryption {
        var situation: Tresorbefund? = null
        override fun verschluessle(klartext: String) = "umhuellt:" + klartext.reversed()
        override fun entschluessle(gespeichert: String) = gespeichert.removePrefix("umhuellt:").reversed()
        override fun oeffne(gespeichert: String): Tresorbefund = situation ?: Tresorbefund.Readable(entschluessle(gespeichert))
    }

    private val tresor = Tresor()
    private val datei = File(folder, "ablage.schluessel")

    @Test
    fun `der Schluessel entsteht einmal und liegt nur umhuellt`() {
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
    fun `nach dem Erneuern ist alles Alte unlesbar, auch nach einem Neustart`() {
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
    fun `ein gesperrter Keystore ersetzt den Schluessel nicht`() {
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
    fun `Klartext und fremde Daten gelten nicht`() {
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
    fun `eine Datei unter fremdem Namen gilt nicht`() {
        val k = Ablageschluessel(datei, tresor)
        val cipher = StoreCipher { k.fuer("antworten") }
        val geheim = cipher.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertNull("Anderer Dateiname", cipher.entschluessle(geheim, "antworten/a/finanzen.json"))
        assertNull("Anderes Fach", cipher.entschluessle(geheim, "antworten/b/sets.json"))
    }
}
