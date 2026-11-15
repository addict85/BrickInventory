package ch.brickinventoryapp.data

import ch.brickinventoryapp.sicherheit.AblageChiffre
import ch.brickinventoryapp.sicherheit.Ablageschluessel
import ch.brickinventoryapp.sicherheit.TokenVerschluesselung
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
 *   D  in AblageChiffre beide `updateAAD(…)` gestrichen → rot „eine
 *      Datei unter fremdem Namen gilt nicht“; gegenproben/ablage-ohne-bindung.patch
 *   F in erneuere() `bekannt = null` gestrichen →
 *      rot „nach dem Erneuern ist alles Alte unlesbar …“
 */
class AblageVerschluesselungTest {

    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-ablage-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun zu() {
        ordner.deleteRecursively()
    }

    /** Wie der Keystore: verändert den Text umkehrbar; [lage] steuert, was oeffne() meldet. */
    private class Tresor : TokenVerschluesselung {
        var lage: Tresorbefund? = null
        override fun verschluessle(klartext: String) = "umhuellt:" + klartext.reversed()
        override fun entschluessle(gespeichert: String) = gespeichert.removePrefix("umhuellt:").reversed()
        override fun oeffne(gespeichert: String): Tresorbefund = lage ?: Tresorbefund.Lesbar(entschluessle(gespeichert))
    }

    private val tresor = Tresor()
    private val datei = File(ordner, "ablage.schluessel")

    @Test
    fun `der Schluessel entsteht einmal und liegt nur umhuellt`() {
        val erster = Ablageschluessel(datei, tresor)
        val k = erster.hole()
        assertEquals(32, k.size)
        assertTrue(erster.neuAngelegt)
        assertTrue("Auf der Platte nur umhüllt", datei.readText().startsWith("umhuellt:"))
        val zweiter = Ablageschluessel(datei, tresor)
        assertArrayEquals("Nach dem Neustart derselbe", k, zweiter.hole())
        assertFalse(zweiter.neuAngelegt)
        assertNotEquals("Je Zweck ein eigener", zweiter.fuer("bestand.db").toList(), zweiter.fuer("antworten").toList())
    }

    @Test
    fun `nach dem Erneuern ist alles Alte unlesbar, auch nach einem Neustart`() {
        val k = Ablageschluessel(datei, tresor)
        var geschlossen = 0
        k.vorErneuerung { geschlossen++ }
        val alt = k.hole().copyOf()
        val geheim = AblageChiffre { k.fuer("antworten") }.verschluessle("Kaufpreis 499.99".toByteArray(), "a")
        k.erneuere()
        assertEquals("Wer den Schlüssel hält, schliesst vorher", 1, geschlossen)
        assertNotEquals(alt.toList(), k.hole().toList())
        assertTrue("Der neue Schlüssel ist als neu gemeldet", k.neuAngelegt)
        assertNull(AblageChiffre { k.fuer("antworten") }.entschluessle(geheim, "a"))
        assertNull("Auch die Platte hat nur den neuen",
            AblageChiffre { Ablageschluessel(datei, tresor).fuer("antworten") }.entschluessle(geheim, "a"))
    }

    @Test
    fun `ein gesperrter Keystore ersetzt den Schluessel nicht`() {
        Ablageschluessel(datei, tresor).hole()
        val vorher = datei.readText()
        tresor.lage = Tresorbefund.Gesperrt
        try {
            Ablageschluessel(datei, tresor).hole()
            fail("Gesperrt muss scheitern, nicht still einen neuen Schlüssel anlegen")
        } catch (_: IOException) {
        }
        assertEquals(vorher, datei.readText())
        tresor.lage = Tresorbefund.Weg
        val neu = Ablageschluessel(datei, tresor)
        neu.hole()
        assertTrue("Weg heisst: neu anlegen und es sagen", neu.neuAngelegt)
        assertNotEquals(vorher, datei.readText())
    }

    @Test
    fun `Klartext und fremde Daten gelten nicht`() {
        val k = Ablageschluessel(datei, tresor)
        val chiffre = AblageChiffre { k.fuer("antworten") }
        val geheim = chiffre.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertEquals("Kaufpreis 499.99", chiffre.entschluessle(geheim, "antworten/a/sets.json")!!.toString(Charsets.UTF_8))
        assertNull("Klartext-Altbestand", chiffre.entschluessle("""{"preis":499.99}""".toByteArray(), "antworten/a/sets.json"))
        assertNull("Anderer Schlüssel", AblageChiffre { k.fuer("widget") }.entschluessle(geheim, "antworten/a/sets.json"))
        geheim[geheim.size - 1] = (geheim[geheim.size - 1] + 1).toByte()
        assertNull("Verändert", chiffre.entschluessle(geheim, "antworten/a/sets.json"))
    }

    @Test
    fun `eine Datei unter fremdem Namen gilt nicht`() {
        val k = Ablageschluessel(datei, tresor)
        val chiffre = AblageChiffre { k.fuer("antworten") }
        val geheim = chiffre.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertNull("Anderer Dateiname", chiffre.entschluessle(geheim, "antworten/a/finanzen.json"))
        assertNull("Anderes Fach", chiffre.entschluessle(geheim, "antworten/b/sets.json"))
    }
}
