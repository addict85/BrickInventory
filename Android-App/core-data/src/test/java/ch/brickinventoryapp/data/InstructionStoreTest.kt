package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.INSTRUCTION_DISPLAY_FOLDER
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.data.util.pdfStore
import ch.brickinventoryapp.data.util.cleanUpInstructions
import ch.brickinventoryapp.data.util.cleanUpPlaintextInstructions
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * Building instructions lie encrypted in the cache: on disk stands
 * neither the PDF nor the set number, an aborted download can be resumed at the right
 * plaintext byte, and sign-out as well as start clean up. Executed against a real
 * directory; decrypting into the memfd needs a device (PdfViewerScreen).
 *
 * Counter-checks:
 *   A  InstructionStore writes and reads via FileSystem.SYSTEM instead of via
 *      EncryptedFileSystem → red “an instruction lies encrypted …”;
 *      counter-checks/anleitung-klartext.patch
 *   B  in EncryptedFileSystem `.part` deleted from INTERMEDIATE_STATES → red “an
 *      aborted download is resumed at the plaintext byte …” (the finished file is
 *      bound to the partial file's name and unreadable)
 *   C  in cleanUpInstructions() the line with INSTRUCTION_PREFIX deleted → red
 *      “sign-out clears all instructions …”; counter-checks/anleitungen-ueberleben-abmelden.patch
 */
class InstructionStoreTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-anleitung-${System.nanoTime()}").apply { mkdirs() }
    private val store = InstructionStore(StoreCipher { ByteArray(32) { 5 } })
    private val address = "https://brick.example/api/v1/instructions/42/file"
    private val pdf = ("%PDF-1.7 Anleitung 75192-1 Millennium Falcon " + "x".repeat(150_000)).toByteArray()

    @After
    fun tearDown() { cache.deleteRecursively() }

    private fun file() = pdfStore(cache, address, false)!!

    private fun put(target: File, content: ByteArray, resume: Boolean = false) =
        store.write(target, resume).use { it.write(content) }

    private fun read(f: File) = store.read(f).use { it.readBytes() }

    @Test
    fun `an instruction lies encrypted and can be read again`() {
        val f = file()
        put(f, pdf)
        val raw = String(f.readBytes(), Charsets.ISO_8859_1)
        assertFalse("Die Datei trägt das PDF im Klartext", "%PDF" in raw)
        assertFalse("Die Datei trägt die Setnummer im Klartext", "75192" in raw)
        assertArrayEquals(pdf, read(f))
    }

    @Test
    fun `an aborted download is resumed at the plaintext byte and counts after renaming`() {
        val f = file()
        val part = File(f.path + ".part")
        put(part, pdf.copyOfRange(0, 100_000))
        assertEquals("Fortsetzpunkt", 100_000L, store.plaintextLength(part))
        put(part, pdf.copyOfRange(100_000, pdf.size), resume = true)
        assertEquals(pdf.size.toLong(), store.plaintextLength(part))
        assertTrue(part.renameTo(f))
        assertArrayEquals("Die fertige Datei trägt die ganze Anleitung", pdf, read(f))
    }

    @Test
    fun `a truncated, foreign or unreadable file does not count`() {
        val f = file()
        put(f, pdf)
        val truncated = File(cache, "gekuerzt").apply { writeBytes(f.readBytes().copyOf(f.length().toInt() - 36)) }
        truncated.copyTo(f, overwrite = true)
        assertTrue("Eine hinten gekürzte Anleitung wird gelesen", runCatching { read(f) }.exceptionOrNull() is IOException)

        put(f, pdf)
        val other = pdfStore(cache, "$address?x", false)!!
        f.copyTo(other)
        assertTrue("Die Kopie unter fremdem Namen gilt", runCatching { read(other) }.exceptionOrNull() is IOException)

        val part = File(f.path + ".part").apply { writeBytes(pdf.copyOf(5000)) }
        assertEquals("Ein Klartext-Rest gilt als Fortsetzpunkt", 0L, store.plaintextLength(part))
        assertFalse("Der unlesbare Rest bleibt liegen", part.exists())
    }

    @Test
    fun `sign-out clears all instructions, the start only the plaintext`() {
        val encrypted = file().also { put(it, pdf) }
        val part = File(encrypted.path + ".part").also { put(it, pdf.copyOf(10)) }
        val old = File(cache, "pdfview_abc.pdf").apply { writeBytes(pdf) }
        val oldPart = File(cache, "pdfview_abc.pdf.part").apply { writeBytes(pdf) }
        val display = File(File(cache, INSTRUCTION_DISPLAY_FOLDER).apply { mkdirs() }, "anzeige1.pdf").apply { writeBytes(pdf) }
        val foreign = File(cache, "anderes.json").apply { writeText("{}") }

        cleanUpPlaintextInstructions(cache)
        assertFalse("Klartext älterer Fassungen bleibt liegen", old.exists() || oldPart.exists())
        assertFalse("Ein Anzeige-Rest bleibt liegen", display.exists())
        assertTrue("Der Start löscht die verschlüsselten Anleitungen", encrypted.exists() && part.exists())

        old.writeBytes(pdf)
        cleanUpInstructions(cache)
        assertFalse("Abmelden lässt eine verschlüsselte Anleitung liegen", encrypted.exists() || part.exists())
        assertFalse("Abmelden lässt Klartext liegen", old.exists())
        assertTrue("Abmelden löscht Fremdes", foreign.exists())
    }
}
