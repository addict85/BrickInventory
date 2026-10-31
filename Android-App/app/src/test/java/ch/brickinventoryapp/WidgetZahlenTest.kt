package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.PortfolioHistoryResponse
import ch.brickinventoryapp.widget.WidgetZahlen
import ch.brickinventoryapp.widget.gvText
import ch.brickinventoryapp.widget.widgetZahlen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Zahlen des Startbildschirm-Widgets, gerechnet aus echten Antworten des
 * Servers (G&V-Übersicht und Wochenverlauf), und ihre Ablage als Text.
 *
 * Gegenproben (30.10.2026, gemessen gegen widget/WidgetZahlen.kt):
 *   A  heute aus dem ERSTEN statt dem vorletzten Punkt → rot „heute ist die
 *      Differenz der letzten zwei Tage“
 *   B  gesamt = wert statt wert - kauf → rot „gesamt ist Wert minus Kaufpreis“
 *   C  in gvText() das Pluszeichen entfernt → rot „ein Gewinn trägt ein Plus“
 */
class WidgetZahlenTest {

    private val pnl = ApiJson.decodeFromString(PnlResponse.serializer(),
        """{"success":true,"currency":"CHF","totals":{"purchase":"1000.00","current":"1250.50","pnl_prozent":25.05}}""")
    private val verlauf = ApiJson.decodeFromString(PortfolioHistoryResponse.serializer(),
        """{"success":true,"currency":"CHF","period":"week","points":[{"value":1200.0},{"value":1240.0},{"value":1250.5}]}""")

    @Test
    fun `gesamt ist Wert minus Kaufpreis`() {
        val z = widgetZahlen(pnl, verlauf, jetzt = 7)!!
        assertEquals(1250.5, z.wert!!, 1e-9)
        assertEquals(250.5, z.gesamt!!, 1e-9)
        assertEquals(25.05, z.gesamtProzent!!, 1e-9)
        assertEquals("CHF", z.waehrung)
        assertEquals(7L, z.stand)
    }

    @Test
    fun `heute ist die Differenz der letzten zwei Tage`() {
        val z = widgetZahlen(pnl, verlauf, jetzt = 0)!!
        assertEquals(10.5, z.heute!!, 1e-9)
        assertEquals(10.5 / 1240.0 * 100, z.heuteProzent!!, 1e-9)
    }

    @Test
    fun `ohne Antworten gibt es nichts zu zeigen, ohne Verlauf kein heute`() {
        assertNull(widgetZahlen(null, null, 0))
        val z = widgetZahlen(pnl, null, 0)!!
        assertNull(z.heute)
        assertEquals("—", gvText(z.heute, z.heuteProzent, z.waehrung))
    }

    @Test
    fun `ein Gewinn traegt ein Plus, ein Verlust sein Minus`() {
        assertTrue(gvText(250.5, 25.05, "CHF").startsWith("+"))
        assertTrue(gvText(250.5, 25.05, "CHF").contains("%"))
        assertTrue(gvText(-3.0, null, "CHF").contains("3.00") || gvText(-3.0, null, "CHF").contains("3,00"))
        assertTrue(!gvText(-3.0, null, "CHF").startsWith("+"))
    }

    @Test
    fun `die Ablage liest zurueck, was sie schrieb`() {
        val z = widgetZahlen(pnl, verlauf, 42)!!
        val text = ApiJson.encodeToString(WidgetZahlen.serializer(), z)
        assertEquals(z, ApiJson.decodeFromString(WidgetZahlen.serializer(), text))
    }
}
