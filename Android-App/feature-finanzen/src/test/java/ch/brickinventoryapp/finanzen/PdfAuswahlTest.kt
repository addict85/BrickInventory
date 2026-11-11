package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.finanzen.ui.PdfAuswahl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Die Route des PDF-Betrachters trägt nur einen Schlüssel; Adresse samt Ticket und
 * Titel liegen in der PdfAuswahl und kommen dort unverändert zurück.
 *
 * Gegenprobe (gegenproben/pdf-auswahl-vergisst.patch): hole() liefert immer null →
 * rot „Adresse und Titel kommen unveraendert zurueck“.
 */
class PdfAuswahlTest {

    @Test
    fun `Adresse und Titel kommen unveraendert zurueck, ein fremder Schluessel nichts`() {
        val adressen = listOf(
            "https://srv/api/v1/anleitungen/Mein%20Plan%2B1.pdf",
            "https://cdn.example/6/1/123456.pdf?ticket=a%2Fb+c&x=%25",
            "https://srv/Bauanleitung Teil 2.pdf",
        )
        val schluessel = adressen.map { PdfAuswahl.lege(it, "100 % C++ / Grüße") }
        assertEquals("je PDF ein eigener Schlüssel", adressen.size, schluessel.toSet().size)
        for ((s, url) in schluessel.zip(adressen)) {
            assertEquals(PdfAuswahl.Pdf(url, "100 % C++ / Grüße"), PdfAuswahl.hole(s))
            assertNotEquals("die Adresse steht nicht im Schlüssel", url, s)
        }
        assertNull(PdfAuswahl.hole("unbekannt"))
    }

    @Test
    fun `nur die letzten acht bleiben, aeltere fallen heraus`() {
        val erster = PdfAuswahl.lege("https://srv/alt.pdf", "alt")
        repeat(8) { PdfAuswahl.lege("https://srv/$it.pdf", "neu $it") }
        assertNull("Die Auswahl wächst nicht ohne Ende", PdfAuswahl.hole(erster))
    }
}
