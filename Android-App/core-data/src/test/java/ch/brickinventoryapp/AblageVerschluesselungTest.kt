package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.room.istKlartextDatenbank
import ch.brickinventoryapp.data.lokal.room.sqlcipherPasswort
import ch.brickinventoryapp.util.AblageChiffre
import ch.brickinventoryapp.util.Ablageschluessel
import ch.brickinventoryapp.util.TokenVerschluesselung
import ch.brickinventoryapp.util.Tresorbefund
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
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
 * Lokale Ablagen liegen verschlüsselt (sec8 N5): Antwort-Cache und Widget mit
 * AES-GCM, der Bestand mit SQLCipher; der gemeinsame Schlüssel nur vom Keystore
 * umhüllt. Hier steht eine Attrappe für den Keystore, die den Klartext sichtbar
 * verändert; SQLCipher selbst läuft nur auf dem Gerät.
 *
 * Gegenproben (03.11.2026, gemessen mit kotlinc lokal):
 *   A  ResponseCache.put() schreibt wieder `text` statt des Geheimtexts → rot „der
 *      Antwort-Cache liegt nicht im Klartext auf der Platte“;
 *      gegenproben/antwort-cache-klartext.patch
 *   B  Ablageschluessel.hole() legt bei Gesperrt einen neuen Schlüssel an (wie bei
 *      Weg) → rot „ein gesperrter Keystore ersetzt den Schluessel nicht“
 *   C  Ablageschluessel.fuer() gibt den gemeinsamen Schlüssel statt eines
 *      abgeleiteten zurück → rot „der Schluessel entsteht einmal …“ und „Klartext
 *      und fremde Daten gelten nicht“ (Widget und Cache teilten einen Schlüssel)
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
        val geheim = chiffre.verschluessle("Kaufpreis 499.99".toByteArray())
        assertEquals("Kaufpreis 499.99", chiffre.entschluessle(geheim)!!.toString(Charsets.UTF_8))
        assertNull("Klartext-Altbestand", chiffre.entschluessle("""{"preis":499.99}""".toByteArray()))
        assertNull("Anderer Schlüssel", AblageChiffre { k.fuer("widget") }.entschluessle(geheim))
        geheim[geheim.size - 1] = (geheim[geheim.size - 1] + 1).toByte()
        assertNull("Verändert", chiffre.entschluessle(geheim))
    }

    @Test
    fun `der Antwort-Cache liegt nicht im Klartext auf der Platte`() = runBlocking {
        val k = Ablageschluessel(datei, tresor)
        // Ein Altbestand der Klartext-Fassung liegt daneben und wird geräumt.
        File(ordner, "api-2/fach/sets.json").apply { parentFile.mkdirs(); writeText("""["Millennium Falcon"]""") }
        val cache = ResponseCache(chiffre = AblageChiffre { k.fuer("antworten") }) { ordner }
        val liste = ListSerializer(String.serializer())
        cache.put("konto", "sets", liste, listOf("Millennium Falcon 75192"))
        val dateien = ordner.walkTopDown().filter { it.isFile && it.name.endsWith(".json") }.toList()
        assertEquals(1, dateien.size)
        assertFalse("Klartext auf der Platte", String(dateien.single().readBytes(), Charsets.ISO_8859_1).contains("Millennium"))
        assertFalse("Die Klartext-Fassung bleibt nicht liegen", File(ordner, "api-2").exists())
        assertEquals(listOf("Millennium Falcon 75192"), cache.getMitStand("konto", "sets", liste)?.first)
        // Eine Datei ohne Verschlüsselung wird nicht gelesen.
        dateien.single().writeText("""["untergeschoben"]""")
        assertNull(cache.getMitStand("konto", "sets", liste))
    }

    @Test
    fun `die Datenbank bekommt einen fertigen Schluessel und erkennt Klartext`() {
        val schluessel = ByteArray(32) { it.toByte() }
        val p = String(sqlcipherPasswort(schluessel), Charsets.US_ASCII)
        assertEquals("x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'", p)
        val klar = File(ordner, "bestand.db").apply { writeBytes("SQLite format 3\u0000".toByteArray() + ByteArray(100)) }
        assertTrue(istKlartextDatenbank(klar))
        val verschluesselt = File(ordner, "neu.db").apply { writeBytes(ByteArray(116) { (it * 7).toByte() }) }
        assertFalse(istKlartextDatenbank(verschluesselt))
        assertFalse(istKlartextDatenbank(File(ordner, "fehlt.db")))
    }
}
