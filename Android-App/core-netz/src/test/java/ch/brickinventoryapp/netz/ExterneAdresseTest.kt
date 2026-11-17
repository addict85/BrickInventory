package ch.brickinventoryapp.netz

import ch.brickinventoryapp.netz.util.eigeneAdresse
import ch.brickinventoryapp.netz.util.externeAdresse
import ch.brickinventoryapp.netz.util.pdfImBetrachter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which addresses from server data the app hands to the browser (https only) and
 * how a `local_path` becomes our own server's address (resolved, never foreign).
 *
 * Gegenproben:
 *   A  in externeAdresse(), removed `.takeIf { it.isHttps }` → red "nur https
 *      geht an den Browser" (http let through)
 *   B  in eigeneAdresse(), removed the same-host check → red "ein
 *      local_path bleibt auf dem eigenen Server"
 *   D  pdfImBetrachter() without the origin
 *      check (`ziel.isHttps || serverUrl.isNotBlank()`) → red "der PDF-Betrachter laedt nur vom eigenen Server"
 */
class ExterneAdresseTest {

    @Test
    fun `nur https geht an den Browser`() {
        assertEquals("https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1",
            externeAdresse(" https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1 ").toString())
        for (fremd in listOf("http://www.bricklink.com/x", "intent://scan/#Intent;scheme=zxing;end", "file:///data/data/x",
                             "content://ch.brickinventoryapp.provider/x", "javascript:alert(1)", "", null)) {
            assertNull("$fremd", externeAdresse(fremd))
        }
    }

    @Test
    fun `der PDF-Betrachter laedt nur vom eigenen Server`() {
        assertTrue(pdfImBetrachter("https://nas:8443/brick/api/v1/vouchers/7/pdf", "https://nas:8443/brick"))
        assertTrue(pdfImBetrachter("https://NAS:8443/uploads/a.pdf", "https://nas:8443/"))
        for (fremd in listOf("https://www.lego.com/cdn/a.pdf", "http://nas:8443/a.pdf", "https://nas:9443/a.pdf",
                             "https://nas.example.evil:8443/a.pdf", "content://x/a.pdf", "")) {
            assertFalse(fremd, pdfImBetrachter(fremd, "https://nas:8443"))
        }
        assertFalse("Ohne Server kein Betrachter", pdfImBetrachter("https://nas:8443/a.pdf", ""))
    }

    @Test
    fun `ein local_path bleibt auf dem eigenen Server`() {
        assertEquals("https://nas:8443/brick/uploads/a.pdf", eigeneAdresse("https://nas:8443/brick/", "uploads/a.pdf"))
        assertEquals("Unterpfad bleibt wie bei der Verkettung",
            "https://nas:8443/brick/uploads/a.pdf", eigeneAdresse("https://nas:8443/brick", "/uploads/a.pdf"))
        assertEquals("https://nas:8443/uploads/a%20b.pdf", eigeneAdresse("https://nas:8443", "/uploads/a b.pdf"))
        assertEquals("Zwei Schrägstriche führen nicht zu einem anderen Host",
            "https://nas:8443/fremd.example/a.pdf", eigeneAdresse("https://nas:8443", "//fremd.example/a.pdf"))
        assertNull(eigeneAdresse("https://nas:8443", "https://fremd.example/a.pdf"))
        assertNull(eigeneAdresse("https://nas:8443", "http://nas:8443/a.pdf"))
    }
}
