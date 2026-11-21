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
 * Counter-check (gegenproben/pdf-auswahl-vergisst.patch): hole() always returns null →
 * red “address and title come back unchanged”.
 */
class PdfSelectionTest {

    @Test
    fun `address and title come back unchanged, a foreign key gives nothing`() {
        val adressen = listOf(
            "https://srv/api/v1/anleitungen/Mein%20Plan%2B1.pdf",
            "https://cdn.example/6/1/123456.pdf?ticket=a%2Fb+c&x=%25",
            "https://srv/Bauanleitung Teil 2.pdf",
        )
        val schluessel = adressen.map { PdfSelection.put(it, "100 % C++ / Grüße") }
        assertEquals("je PDF ein eigener Schlüssel", adressen.size, schluessel.toSet().size)
        for ((s, url) in schluessel.zip(adressen)) {
            assertEquals(PdfSelection.Pdf(url, "100 % C++ / Grüße"), PdfSelection.fetch(s))
            assertNotEquals("die Adresse steht nicht im Schlüssel", url, s)
        }
        assertNull(PdfSelection.fetch("unbekannt"))
    }

    @Test
    fun `only the last eight stay, older ones drop out`() {
        val erster = PdfSelection.put("https://srv/alt.pdf", "alt")
        repeat(8) { PdfSelection.put("https://srv/$it.pdf", "neu $it") }
        assertNull("Die Auswahl wächst nicht ohne Ende", PdfSelection.fetch(erster))
    }
}
