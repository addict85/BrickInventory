package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.finanzen.ui.screens.GutscheinFeld.BETRAG
import ch.brickinventoryapp.finanzen.ui.screens.GutscheinFeld.NUMMER
import ch.brickinventoryapp.finanzen.ui.screens.gutscheinFehler
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Was „Speichern“ im Gutscheinformular markiert, bevor etwas hinausgeht; das erste Feld
 * bekommt den Cursor. Mit PDF liest der Server, was leer ist.
 *
 * Gegenprobe (gemessen lokal, JVM):
 *   gutschein-pdf-verlangt-nummer  Nummer auch mit PDF Pflicht → rot „mit PDF …“
 */
class GutscheinFormularPruefungTest {

    @Test
    fun `ohne PDF fehlen leere Nummer und Betrag, in dieser Reihenfolge`() {
        assertEquals(listOf(NUMMER, BETRAG), gutscheinFehler("", "", mitPdf = false))
        assertEquals(listOf(BETRAG), gutscheinFehler("6061 2345", "zwanzig", mitPdf = false))
        assertEquals(emptyList<Any>(), gutscheinFehler("6061 2345", "20,50", mitPdf = false))
    }

    @Test
    fun `mit PDF darf leer bleiben, was der Server liest, ein unlesbarer Betrag nicht`() {
        assertEquals(emptyList<Any>(), gutscheinFehler("", "", mitPdf = true))
        assertEquals(listOf(BETRAG), gutscheinFehler("", "1.2.3", mitPdf = true))
    }
}
