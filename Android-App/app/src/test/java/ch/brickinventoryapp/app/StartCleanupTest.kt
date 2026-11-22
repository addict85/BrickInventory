package ch.brickinventoryapp.app

import ch.brickinventoryapp.data.util.PDF_CONFIDENTIAL_FOLDER
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * The start clears what an aborted run or an older version left: voucher PDFs, plaintext
 * manuals and image caches, an expired parts list. An encrypted manual stays.
 *
 * Counter-checks (local):
 *   cleanUpConfidentialPdfs removed from cleanUpLeftovers      → red (the voucher PDF stays)
 *   cleanUpPlaintextInstructions removed from cleanUpLeftovers → red (the plaintext manual stays)
 */
class StartCleanupTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "start-${System.nanoTime()}")
    private val cache = File(root, "cache")
    private val files = File(root, "files")

    @After
    fun tearDown() { root.deleteRecursively() }

    private fun file(basis: File, path: String, age: Long = 0) =
        File(basis, path).apply { parentFile!!.mkdirs(); writeText("PIN 1234"); if (age > 0) setLastModified(1_000L) }

    @Test
    fun `the start clears leftovers and keeps encrypted manuals`() {
        val leftovers = listOf(
            file(cache, "$PDF_CONFIDENTIAL_FOLDER/pdfview_alt.pdf"),
            file(cache, "pdfview_75192.pdf"),
            file(cache, "image_cache/a.jpg"),
            file(files, "pdf/teileliste.bin", age = 1),
        )
        val manual = file(cache, "anleitung_e3b0.bin")
        cleanUpLeftovers(cache, files, now = 400L * 24 * 60 * 60 * 1000)
        assertEquals(emptyList<File>(), leftovers.filter { it.exists() })
        assertEquals(listOf(manual), listOf(manual).filter { it.exists() })
    }
}
