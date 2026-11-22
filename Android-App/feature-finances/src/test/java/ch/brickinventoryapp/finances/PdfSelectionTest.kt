package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.PdfSelection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The PDF viewer's route carries only one key; the address along with its ticket and
 * title live in the PdfSelection and come back from there unchanged.
 *
 * Counter-check (counter-checks/pdf-auswahl-vergisst.patch): hole() always returns null →
 * red “address and title come back unchanged”.
 */
class PdfSelectionTest {

    @Test
    fun `address and title come back unchanged, a foreign key gives nothing`() {
        val addresses = listOf(
            "https://srv/api/v2/anleitungen/Mein%20Plan%2B1.pdf",
            "https://cdn.example/6/1/123456.pdf?ticket=a%2Fb+c&x=%25",
            "https://srv/Bauanleitung Teil 2.pdf",
        )
        val key = addresses.map { PdfSelection.put(it, "100 % C++ / Grüße") }
        assertEquals("a key of its own per PDF", addresses.size, key.toSet().size)
        for ((s, url) in key.zip(addresses)) {
            assertEquals(PdfSelection.Pdf(url, "100 % C++ / Grüße"), PdfSelection.fetch(s))
            assertNotEquals("the address does not stand in the key", url, s)
        }
        assertNull(PdfSelection.fetch("unbekannt"))
    }

    @Test
    fun `only the last eight stay, older ones drop out`() {
        val first = PdfSelection.put("https://srv/alt.pdf", "alt")
        repeat(8) { PdfSelection.put("https://srv/$it.pdf", "neu $it") }
        assertNull("the selection does not grow without end", PdfSelection.fetch(first))
    }
}
