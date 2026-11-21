package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.INSTRUCTION_DISPLAY_FOLDER
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.data.util.InstructionStore
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
 *   A  InstructionStore schreibt und liest über FileSystem.SYSTEM statt über
 *      EncryptedFileSystem → rot „eine Anleitung liegt verschluesselt …“;
 *      gegenproben/anleitung-klartext.patch
 *   B  in EncryptedFileSystem `.part` aus INTERMEDIATE_STATES gestrichen → rot „ein
 *      abgebrochener Download wird am Klartext-Byte fortgesetzt …“ (die fertige Datei ist
 *      an den Namen der Teildatei gebunden und unlesbar)
 *   C  in raeumeAnleitungenAuf() die Zeile mit INSTRUCTION_PREFIX gestrichen → rot
 *      „Abmelden raeumt alle Anleitungen weg …“; gegenproben/anleitungen-ueberleben-abmelden.patch
 */
class InstructionStoreTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-anleitung-${System.nanoTime()}").apply { mkdirs() }
    private val ablage = InstructionStore(StoreCipher { ByteArray(32) { 5 } })
    private val adresse = "https://brick.example/api/v1/instructions/42/file"
    private val pdf = ("%PDF-1.7 Anleitung 75192-1 Millennium Falcon " + "x".repeat(150_000)).toByteArray()

    @After
    fun zu() { cache.deleteRecursively() }

    private fun datei() = pdfAblage(cache, adresse, false)!!

    private fun ablegen(ziel: File, inhalt: ByteArray, resume: Boolean = false) =
        ablage.schreibe(ziel, resume).use { it.write(inhalt) }

    private fun lies(f: File) = ablage.lies(f).use { it.readBytes() }

    @Test
    fun `an instruction lies encrypted and can be read again`() {
        val f = datei()
        ablegen(f, pdf)
        val roh = String(f.readBytes(), Charsets.ISO_8859_1)
        assertFalse("Die Datei trägt das PDF im Klartext", "%PDF" in roh)
        assertFalse("Die Datei trägt die Setnummer im Klartext", "75192" in roh)
        assertArrayEquals(pdf, lies(f))
    }

    @Test
    fun `an aborted download is resumed at the plaintext byte and counts after renaming`() {
        val f = datei()
        val teil = File(f.path + ".part")
        ablegen(teil, pdf.copyOfRange(0, 100_000))
        assertEquals("Fortsetzpunkt", 100_000L, ablage.plaintextLength(teil))
        ablegen(teil, pdf.copyOfRange(100_000, pdf.size), resume = true)
        assertEquals(pdf.size.toLong(), ablage.plaintextLength(teil))
        assertTrue(teil.renameTo(f))
        assertArrayEquals("Die fertige Datei trägt die ganze Anleitung", pdf, lies(f))
    }

    @Test
    fun `a truncated, foreign or unreadable file does not count`() {
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
        assertEquals("Ein Klartext-Rest gilt als Fortsetzpunkt", 0L, ablage.plaintextLength(teil))
        assertFalse("Der unlesbare Rest bleibt liegen", teil.exists())
    }

    @Test
    fun `sign-out clears all instructions, the start only the plaintext`() {
        val encrypted = datei().also { ablegen(it, pdf) }
        val teil = File(encrypted.path + ".part").also { ablegen(it, pdf.copyOf(10)) }
        val alt = File(cache, "pdfview_abc.pdf").apply { writeBytes(pdf) }
        val altPart = File(cache, "pdfview_abc.pdf.part").apply { writeBytes(pdf) }
        val anzeige = File(File(cache, INSTRUCTION_DISPLAY_FOLDER).apply { mkdirs() }, "anzeige1.pdf").apply { writeBytes(pdf) }
        val fremd = File(cache, "anderes.json").apply { writeText("{}") }

        raeumeKlartextAnleitungenAuf(cache)
        assertFalse("Klartext älterer Fassungen bleibt liegen", alt.exists() || altPart.exists())
        assertFalse("Ein Anzeige-Rest bleibt liegen", anzeige.exists())
        assertTrue("Der Start löscht die verschlüsselten Anleitungen", encrypted.exists() && teil.exists())

        alt.writeBytes(pdf)
        raeumeAnleitungenAuf(cache)
        assertFalse("Abmelden lässt eine verschlüsselte Anleitung liegen", encrypted.exists() || teil.exists())
        assertFalse("Abmelden lässt Klartext liegen", alt.exists())
        assertTrue("Abmelden löscht Fremdes", fremd.exists())
    }
}
