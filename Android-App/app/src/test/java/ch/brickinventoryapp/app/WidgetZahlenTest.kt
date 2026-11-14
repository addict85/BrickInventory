package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.vertrag.PnlResponse
import ch.brickinventoryapp.vertrag.PortfolioHistoryResponse
import ch.brickinventoryapp.app.widget.OhneToken
import ch.brickinventoryapp.app.widget.WIDGET_VERDECKT
import ch.brickinventoryapp.app.widget.ohneToken
import ch.brickinventoryapp.app.widget.WidgetZahlen
import ch.brickinventoryapp.app.widget.gvText
import ch.brickinventoryapp.app.widget.widgetAnzeige
import ch.brickinventoryapp.app.widget.widgetWerte
import ch.brickinventoryapp.app.widget.widgetZahlen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Zahlen des Startbildschirm-Widgets, gerechnet aus echten Antworten des
 * Servers (G&V-Übersicht und Wochenverlauf), und ihre Ablage als Text.
 *
 * Gegenproben:
 *   A  heute aus dem ERSTEN statt dem vorletzten Punkt → rot „heute ist die
 *      Differenz der letzten zwei Tage“
 *   B  gesamt = wert statt wert - kauf → rot „gesamt ist Wert minus Kaufpreis“
 *   C  in gvText() das Pluszeichen entfernt → rot „ein Gewinn trägt ein Plus“
 *   D  widgetAnzeige() gibt immer `abgelegt` zurück → rot
 *      „abgemeldet zeigt das Widget keine Zahlen“
 *   E  widgetWerte() ohne die Abfrage von
 *      `zeigen` → rot „ohne Erlaubnis sind die Betraege verdeckt“;
 *      gegenproben/widget-zeigt-betraege.patch
 *   F  gegenproben/widget-guv-aus-allen.patch: Basis
 *      übergangen → rot „mit Basis stehen Wert und G&V wie in der Finanzkarte“
 *      (32.40 statt 212.40)
 *   G  ohneToken() immer LEEREN → rot „ohne Token leert der Arbeiter nur abgemeldet …“;
 *      gegenproben/widget-leert-bei-sperre.patch
 */
class WidgetZahlenTest {

    private val pnl = BrickJson.decodeFromString(PnlResponse.serializer(),
        """{"success":true,"currency":"CHF","totals":{"purchase":"1000.00","current":"1250.50","pnl_prozent":25.05}}""")
    private val verlauf = BrickJson.decodeFromString(PortfolioHistoryResponse.serializer(),
        """{"success":true,"currency":"CHF","period":"week","points":[{"value":1200.0},{"value":1240.0},{"value":1250.5}]}""")

    @Test
    fun `abgemeldet zeigt das Widget keine Zahlen`() {
        val z = widgetZahlen(pnl, verlauf, jetzt = 7)!!
        assertNull("Die Ablage hält noch Zahlen, gezeigt werden sie nicht", widgetAnzeige(z, angemeldet = false))
        assertEquals(z, widgetAnzeige(z, angemeldet = true))
    }

    @Test
    fun `ohne Token leert der Arbeiter nur abgemeldet, bei gesperrtem Geraet wartet er`() {
        assertEquals(OhneToken.LEEREN, ohneToken(geraetGesperrt = false))
        assertEquals(OhneToken.SPAETER, ohneToken(geraetGesperrt = true))
    }

    @Test
    fun `gesamt ist Wert minus Kaufpreis`() {
        val z = widgetZahlen(pnl, verlauf, jetzt = 7)!!
        assertEquals(1250.5, z.wert!!, 1e-9)
        assertEquals(250.5, z.gesamt!!, 1e-9)
        assertEquals(25.05, z.gesamtProzent!!, 1e-9)
        assertEquals(Waehrung.CHF, z.waehrung)
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
        assertTrue(gvText(250.5, 25.05, Waehrung("CHF")).startsWith("+"))
        assertTrue(gvText(250.5, 25.05, Waehrung("CHF")).contains("%"))
        assertTrue(gvText(-3.0, null, Waehrung("CHF")).contains("3.00") || gvText(-3.0, null, Waehrung("CHF")).contains("3,00"))
        assertTrue(!gvText(-3.0, null, Waehrung("CHF")).startsWith("+"))
    }

    @Test
    fun `ohne Erlaubnis sind die Betraege verdeckt`() {
        val z = widgetZahlen(pnl, verlauf, jetzt = 7)!!
        val verdeckt = widgetWerte(z, zeigen = false)
        assertEquals(Triple(WIDGET_VERDECKT, WIDGET_VERDECKT, WIDGET_VERDECKT), verdeckt)
        val offen = widgetWerte(z, zeigen = true)
        assertTrue("Mit Erlaubnis steht der Wert da", offen.first.contains("1") && offen.first != WIDGET_VERDECKT)
        assertTrue(offen.third.startsWith("+"))
    }

    /** Die Prozentzahl rechnet der Server auf der Basis; der Betrag daneben muss es auch. */
    @Test
    fun `mit Basis stehen Wert und G&V wie in der Finanzkarte`() {
        val basis = BrickJson.decodeFromString(PnlResponse.serializer(), """{"success":true,"currency":"CHF","totals":{
            "purchase":"1680.00","current":"1712.40","pnl_prozent":14.2,"positionen":3,"positionen_bewertet":2,
            "positionen_ohne_marktpreis":1,"positionen_ohne_kaufpreis":0,"basis_einstand":"1500.00",
            "basis_marktwert":"1712.40","basis_guv_betrag":"212.40","ohne_marktpreis_einstand":"180.00",
            "ohne_kaufpreis_marktwert":"0.00"}}""")
        val z = widgetZahlen(basis, verlauf, jetzt = 7)!!
        assertEquals(1712.4, z.wert!!, 1e-9)
        assertEquals(212.4, z.gesamt!!, 1e-9)
        assertEquals(14.2, z.gesamtProzent!!, 1e-9)
    }

    @Test
    fun `die Ablage liest zurueck, was sie schrieb`() {
        val z = widgetZahlen(pnl, verlauf, 42)!!
        val text = BrickJson.encodeToString(WidgetZahlen.serializer(), z)
        assertEquals(z, BrickJson.decodeFromString(WidgetZahlen.serializer(), text))
    }
}
