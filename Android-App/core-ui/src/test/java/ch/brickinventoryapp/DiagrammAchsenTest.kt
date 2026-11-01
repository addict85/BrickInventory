package ch.brickinventoryapp

import ch.brickinventoryapp.ui.lokaleAchse
import ch.brickinventoryapp.ui.lokaleWerte
import ch.brickinventoryapp.ui.model.DiagrammAchse
import ch.brickinventoryapp.ui.model.DiagrammPunkt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Die Achsen der Wertentwicklung folgen der App-Sprache statt der festen
 * Schweizer Form des Servers („03.10“, „CHF 1'234“).
 *
 * Gegenproben (01.11.2026, modbau/kotlinc):
 *   A  lokaleAchse gibt `punkte` unverändert zurück → rot: „englisch Monat vor Tag“,
 *      „deutsch mit Monatsnamen“, „Monatsaufloesung zeigt Monat und Jahr“
 *   B  Muster "d. MMM" auch für Englisch → rot: „englisch Monat vor Tag“ („3. Oct“)
 *   C  maximumFractionDigits = 2 in lokaleWerte → rot: „y-Achse ganze Beträge …“
 */
class DiagrammAchsenTest {

    private val punkte = listOf(
        DiagrammPunkt("03.10", 100.0, 0.0),
        DiagrammPunkt("", 110.0, 0.5),
        DiagrammPunkt("05.10", 120.0, 1.0),
    )
    private val tage = listOf("2026-10-03", "2026-10-04", "2026-10-05")

    @Test
    fun `englisch Monat vor Tag`() {
        val l = lokaleAchse(punkte, tage, Locale.forLanguageTag("en-GB")).map { it.xLabel }
        assertEquals(listOf("Oct 3", "", "Oct 5"), l)
    }

    @Test
    fun `deutsch mit Monatsnamen`() {
        val l = lokaleAchse(punkte, tage, Locale.forLanguageTag("de-CH")).map { it.xLabel }
        assertEquals(listOf("3. Okt.", "", "5. Okt."), l)
    }

    @Test
    fun `Monatsaufloesung zeigt Monat und Jahr`() {
        val monat = listOf(DiagrammPunkt("10/25", 1.0, 0.0), DiagrammPunkt("11/25", 2.0, 1.0))
        val l = lokaleAchse(monat, listOf("2025-10-01", "2025-11-01"), Locale.forLanguageTag("en-GB"))
        assertEquals(listOf("Oct 25", "Nov 25"), l.map { it.xLabel })
    }

    @Test
    fun `ohne passende Tage bleibt der Text des Servers`() {
        assertEquals(punkte, lokaleAchse(punkte, tage.take(2), Locale.forLanguageTag("en-GB")))
    }

    @Test
    fun `y-Achse ganze Betraege mit Tausendern der Sprache`() {
        val achse = listOf(DiagrammAchse("CHF 1'234", 1234.0, 0.0), DiagrammAchse("CHF 2'000", 2000.4, 1.0))
        val en = lokaleWerte(achse, "CHF", Locale.forLanguageTag("en-GB")).map { it.label }
        assertTrue(en.toString(), en[0].contains("1,234") && en[1].contains("2,000") && en.none { "." in it })
        val de = lokaleWerte(achse, "CHF", Locale.forLanguageTag("de-CH")).map { it.label }
        assertTrue(de.toString(), de[0].contains("1’234") || de[0].contains("1'234"))
    }
}
