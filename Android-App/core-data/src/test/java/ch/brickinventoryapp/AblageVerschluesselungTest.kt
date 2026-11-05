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
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Lokale Ablagen liegen verschlüsselt: Antwort-Cache und Widget mit
 * AES-GCM, der Bestand mit SQLCipher; der gemeinsame Schlüssel nur vom Keystore
 * umhüllt. Hier steht eine Attrappe für den Keystore, die den Klartext sichtbar
 * verändert; SQLCipher selbst läuft nur auf dem Gerät.
 *
 * Gegenproben:
 *   A  ResponseCache.put() schreibt wieder `text` statt des Geheimtexts → rot „der
 *      Antwort-Cache liegt nicht im Klartext auf der Platte“;
 *      gegenproben/antwort-cache-klartext.patch
 *   B  Ablageschluessel.hole() legt bei Gesperrt einen neuen Schlüssel an (wie bei
 *      Weg) → rot „ein gesperrter Keystore ersetzt den Schluessel nicht“
 *   C  Ablageschluessel.fuer() gibt den gemeinsamen Schlüssel statt eines
 *      abgeleiteten zurück → rot „der Schluessel entsteht einmal …“ und „Klartext
 *      und fremde Daten gelten nicht“ (Widget und Cache teilten einen Schlüssel)
 *   D  in AblageChiffre beide `updateAAD(…)` gestrichen → rot „eine
 *      Datei unter fremdem Namen gilt nicht“; gegenproben/ablage-ohne-bindung.patch
 *   E  im Antwort-Cache den Aufruf uebernimm(…) gestrichen → rot „der Bestand ohne
 *      Bindung wird uebernommen …“ (der Cache war nach dem Update leer);
 *      gegenproben/antwort-cache-ohne-uebernahme.patch
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
        val geheim = chiffre.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertEquals("Kaufpreis 499.99", chiffre.entschluessle(geheim, "antworten/a/sets.json")!!.toString(Charsets.UTF_8))
        assertNull("Klartext-Altbestand", chiffre.entschluessle("""{"preis":499.99}""".toByteArray(), "antworten/a/sets.json"))
        assertNull("Anderer Schlüssel", AblageChiffre { k.fuer("widget") }.entschluessle(geheim, "antworten/a/sets.json"))
        geheim[geheim.size - 1] = (geheim[geheim.size - 1] + 1).toByte()
        assertNull("Verändert", chiffre.entschluessle(geheim, "antworten/a/sets.json"))
    }

    @Test
    fun `eine Datei unter fremdem Namen gilt nicht`() = runBlocking {
        val k = Ablageschluessel(datei, tresor)
        val chiffre = AblageChiffre { k.fuer("antworten") }
        val geheim = chiffre.verschluessle("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertNull("Anderer Dateiname", chiffre.entschluessle(geheim, "antworten/a/finanzen.json"))
        assertNull("Anderes Fach", chiffre.entschluessle(geheim, "antworten/b/sets.json"))
        // Im Cache: Zwei echte Dateien desselben Zwecks vertauscht, keine gilt mehr.
        val cache = ResponseCache(chiffre = chiffre) { ordner }
        val liste = ListSerializer(String.serializer())
        cache.put("konto", "sets", liste, listOf("Millennium Falcon 75192"))
        cache.put("konto", "wunsch", liste, listOf("Todesstern 75159"))
        val fach = File(ordner, "api-4/" + ResponseCache.bereichsName("konto"))
        val sets = File(fach, "sets.json")
        val wunsch = File(fach, "wunsch.json")
        val a = sets.readBytes()
        sets.writeBytes(wunsch.readBytes())
        wunsch.writeBytes(a)
        assertNull("Vertauscht gelesen", cache.getMitStand("konto", "sets", liste))
        assertNull("Vertauscht gelesen", cache.getMitStand("konto", "wunsch", liste))
    }

    /** Wie die ältere AblageChiffre: Kennung 1, ohne AAD. */
    private fun ungebunden(schluessel: ByteArray, klartext: ByteArray): ByteArray {
        val iv = ByteArray(12) { it.toByte() }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(schluessel, "AES"), GCMParameterSpec(128, iv))
        return byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 1) + iv + c.doFinal(klartext)
    }

    @Test
    fun `der Bestand ohne Bindung wird uebernommen, ein spaeter eingelegter nicht`() = runBlocking {
        val k = Ablageschluessel(datei, tresor)
        val liste = ListSerializer(String.serializer())
        val name = ResponseCache.bereichsName("konto")
        val stand = System.currentTimeMillis() - 3_600_000
        File(ordner, "api-3/$name/sets.json").apply {
            parentFile!!.mkdirs()
            writeBytes(ungebunden(k.fuer("antworten"), """["Millennium Falcon 75192"]""".toByteArray()))
            setLastModified(stand)
        }
        val cache = ResponseCache(chiffre = AblageChiffre { k.fuer("antworten") }) { ordner }
        val gelesen = cache.getMitStand("konto", "sets", liste)
        assertEquals("Ohne Datenverlust", listOf("Millennium Falcon 75192"), gelesen?.first)
        assertEquals("Der Stand bleibt", stand / 1000, gelesen!!.second / 1000)
        assertFalse("Die Vorfassung bleibt nicht liegen", File(ordner, "api-3").exists())
        assertEquals("Gebunden neu abgelegt", 2.toByte(), File(ordner, "api-4/$name/sets.json").readBytes()[3])
        // Danach gilt eine Datei ohne Bindung nicht mehr, auch nicht am richtigen Ort.
        File(ordner, "api-4/$name/sets.json").writeBytes(ungebunden(k.fuer("antworten"), """["untergeschoben"]""".toByteArray()))
        assertNull(cache.getMitStand("konto", "sets", liste))
    }

    @Test
    fun `der Antwort-Cache liegt nicht im Klartext auf der Platte`() = runBlocking {
        val k = Ablageschluessel(datei, tresor)
        // Ein Altbestand der Klartext-Fassung liegt daneben und wird geräumt.
        File(ordner, "api-2/fach/sets.json").apply { parentFile!!.mkdirs(); writeText("""["Millennium Falcon"]""") }
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
