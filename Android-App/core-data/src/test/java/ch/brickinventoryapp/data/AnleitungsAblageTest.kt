package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.ANLEITUNG_ANZEIGE_ORDNER
import ch.brickinventoryapp.sicherheit.AblageChiffre
import ch.brickinventoryapp.data.util.AnleitungsAblage
import ch.brickinventoryapp.data.util.pdfAblage
import ch.brickinventoryapp.data.util.raeumeAnleitungenAuf
import ch.brickinventoryapp.data.util.raeumeKlartextAnleitungenAuf
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * Bauanleitungen liegen verschlüsselt im Zwischenspeicher: Auf der Platte steht
 * weder das PDF noch die Setnummer, ein abgebrochener Download lässt sich am richtigen
 * Klartext-Byte fortsetzen, und Abmelden wie Start räumen auf. Ausgeführt gegen ein echtes
 * Verzeichnis; das Entschlüsseln in den memfd braucht ein Gerät (PdfViewerScreen).
 *
 * Gegenproben:
 *   A  AnleitungsAblage schreibt und liest über FileSystem.SYSTEM statt über
 *      VerschluesseltesDateisystem → rot „eine Anleitung liegt verschluesselt …“;
 *      gegenproben/anleitung-klartext.patch
 *   B  in VerschluesseltesDateisystem `.part` aus ZWISCHENSTAENDE gestrichen → rot „ein
 *      abgebrochener Download wird am Klartext-Byte fortgesetzt …“ (die fertige Datei ist
 *      an den Namen der Teildatei gebunden und unlesbar)
 *   C  in raeumeAnleitungenAuf() die Zeile mit ANLEITUNG_PRAEFIX gestrichen → rot
 *      „Abmelden raeumt alle Anleitungen weg …“; gegenproben/anleitungen-ueberleben-abmelden.patch
 */
class AnleitungsAblageTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-anleitung-${System.nanoTime()}").apply { mkdirs() }
    private val ablage = AnleitungsAblage(AblageChiffre { ByteArray(32) { 5 } })
    private val adresse = "https://brick.example/api/v1/instructions/42/file"
    private val pdf = ("%PDF-1.7 Anleitung 75192-1 Millennium Falcon " + "x".repeat(150_000)).toByteArray()

    @After
    fun zu() { cache.deleteRecursively() }

    private fun datei() = pdfAblage(cache, adresse, false)!!

    private fun ablegen(ziel: File, inhalt: ByteArray, fortsetzen: Boolean = false) =
        ablage.schreibe(ziel, fortsetzen).use { it.write(inhalt) }

    private fun lies(f: File) = ablage.lies(f).use { it.readBytes() }

    @Test
    fun `eine Anleitung liegt verschluesselt und laesst sich wieder lesen`() {
        val f = datei()
        ablegen(f, pdf)
        val roh = String(f.readBytes(), Charsets.ISO_8859_1)
        assertFalse("Die Datei trägt das PDF im Klartext", "%PDF" in roh)
        assertFalse("Die Datei trägt die Setnummer im Klartext", "75192" in roh)
        assertArrayEquals(pdf, lies(f))
    }

    @Test
    fun `ein abgebrochener Download wird am Klartext-Byte fortgesetzt und gilt nach dem Umbenennen`() {
        val f = datei()
        val teil = File(f.path + ".part")
        ablegen(teil, pdf.copyOfRange(0, 100_000))
        assertEquals("Fortsetzpunkt", 100_000L, ablage.klartextLaenge(teil))
        ablegen(teil, pdf.copyOfRange(100_000, pdf.size), fortsetzen = true)
        assertEquals(pdf.size.toLong(), ablage.klartextLaenge(teil))
        assertTrue(teil.renameTo(f))
        assertArrayEquals("Die fertige Datei trägt die ganze Anleitung", pdf, lies(f))
    }

    @Test
    fun `eine gekuerzte, fremde oder unlesbare Datei gilt nicht`() {
        val f = datei()
        ablegen(f, pdf)
        val gekuerzt = File(cache, "gekuerzt").apply { writeBytes(f.readBytes().copyOf(f.length().toInt() - 36)) }
        gekuerzt.copyTo(f, overwrite = true)
        assertTrue("Eine hinten gekürzte Anleitung wird gelesen", runCatching { lies(f) }.exceptionOrNull() is IOException)

        ablegen(f, pdf)
        val andere = pdfAblage(cache, "$adresse?x", false)!!
        f.copyTo(andere)
        assertTrue("Die Kopie unter fremdem Namen gilt", runCatching { lies(andere) }.exceptionOrNull() is IOException)

        val teil = File(f.path + ".part").apply { writeBytes(pdf.copyOf(5000)) }
        assertEquals("Ein Klartext-Rest gilt als Fortsetzpunkt", 0L, ablage.klartextLaenge(teil))
        assertFalse("Der unlesbare Rest bleibt liegen", teil.exists())
    }

    @Test
    fun `Abmelden raeumt alle Anleitungen weg, der Start nur den Klartext`() {
        val verschluesselt = datei().also { ablegen(it, pdf) }
        val teil = File(verschluesselt.path + ".part").also { ablegen(it, pdf.copyOf(10)) }
        val alt = File(cache, "pdfview_abc.pdf").apply { writeBytes(pdf) }
        val altTeil = File(cache, "pdfview_abc.pdf.part").apply { writeBytes(pdf) }
        val anzeige = File(File(cache, ANLEITUNG_ANZEIGE_ORDNER).apply { mkdirs() }, "anzeige1.pdf").apply { writeBytes(pdf) }
        val fremd = File(cache, "anderes.json").apply { writeText("{}") }

        raeumeKlartextAnleitungenAuf(cache)
        assertFalse("Klartext älterer Fassungen bleibt liegen", alt.exists() || altTeil.exists())
        assertFalse("Ein Anzeige-Rest bleibt liegen", anzeige.exists())
        assertTrue("Der Start löscht die verschlüsselten Anleitungen", verschluesselt.exists() && teil.exists())

        alt.writeBytes(pdf)
        raeumeAnleitungenAuf(cache)
        assertFalse("Abmelden lässt eine verschlüsselte Anleitung liegen", verschluesselt.exists() || teil.exists())
        assertFalse("Abmelden lässt Klartext liegen", alt.exists())
        assertTrue("Abmelden löscht Fremdes", fremd.exists())
    }
}
