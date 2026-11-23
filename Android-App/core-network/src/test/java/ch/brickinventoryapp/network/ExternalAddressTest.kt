package ch.brickinventoryapp.network

import ch.brickinventoryapp.network.util.externalAddress
import ch.brickinventoryapp.network.util.ownAddress
import ch.brickinventoryapp.network.util.pdfInViewer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which addresses from server data the app hands to the browser (https only) and
 * how a `local_path` becomes our own server's address (resolved, never foreign).
 *
 * Counter-checks:
 *   A  in externalAddress(), removed `.takeIf { it.isHttps }` → red “only https
 *      goes to the browser” (http let through)
 *   B  in ownAddress(), removed the same-host check → red “a
 *      local_path stays on the own server”
 *   D  pdfInViewer() without the origin
 *      check (`target.isHttps || serverUrl.isNotBlank()`) → red “the PDF viewer loads only from the own server”
 */
class ExternalAddressTest {

    @Test
    fun `only https goes to the browser`() {
        assertEquals("https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1",
            externalAddress(" https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1 ").toString())
        for (foreign in listOf("http://www.bricklink.com/x", "intent://scan/#Intent;scheme=zxing;end", "file:///data/data/x",
                             "content://ch.brickinventoryapp.provider/x", "javascript:alert(1)", "", null)) {
            assertNull("$foreign", externalAddress(foreign))
        }
    }

    @Test
    fun `the PDF viewer loads only from the own server`() {
        assertTrue(pdfInViewer("https://nas:8443/brick/api/v2/vouchers/7/pdf", "https://nas:8443/brick"))
        assertTrue(pdfInViewer("https://NAS:8443/uploads/a.pdf", "https://nas:8443/"))
        for (foreign in listOf("https://www.lego.com/cdn/a.pdf", "http://nas:8443/a.pdf", "https://nas:9443/a.pdf",
                             "https://nas.example.evil:8443/a.pdf", "content://x/a.pdf", "")) {
            assertFalse(foreign, pdfInViewer(foreign, "https://nas:8443"))
        }
        assertFalse("without a server no viewer", pdfInViewer("https://nas:8443/a.pdf", ""))
    }

    @Test
    fun `a local_path stays on the own server`() {
        assertEquals("https://nas:8443/brick/uploads/a.pdf", ownAddress("https://nas:8443/brick/", "uploads/a.pdf"))
        assertEquals("the sub-path stays as with the concatenation",
            "https://nas:8443/brick/uploads/a.pdf", ownAddress("https://nas:8443/brick", "/uploads/a.pdf"))
        assertEquals("https://nas:8443/uploads/a%20b.pdf", ownAddress("https://nas:8443", "/uploads/a b.pdf"))
        assertEquals("two slashes do not lead to another host",
            "https://nas:8443/fremd.example/a.pdf", ownAddress("https://nas:8443", "//fremd.example/a.pdf"))
        assertNull(ownAddress("https://nas:8443", "https://fremd.example/a.pdf"))
        assertNull(ownAddress("https://nas:8443", "http://nas:8443/a.pdf"))
    }
}
