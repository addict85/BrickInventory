package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.ChartPoint
import ch.brickinventoryapp.data.model.CsvArt
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.data.model.StartupStatus
import ch.brickinventoryapp.ui.model.CsvImportArt
import ch.brickinventoryapp.ui.model.OHNE_FARBE
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.ui.model.alsDaten
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Abbildungen von Server-Modellen auf UI-Modelle (ui/model): Was die
 * Oberfläche bekommt, ist schon aufbereitet — Anteile gerechnet, Richtung als
 * Wahrheitswert, die CSV-Art hin und zurück verlustfrei.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in StartzustandAnsicht.anteil die Prüfung `gesamt > 0` entfernt → rot
 *      „ohne Gesamtzahl gibt es keinen Anteil“ (Infinity statt null)
 *   B  in CsvImportArt.alsDaten TEILE → CsvArt.SETS → rot „jede CSV-Art kommt
 *      unverändert an“
 *   C  in PreisalarmAnsicht.unter `== "unter"` → `== "ueber"` → rot
 */
class UiModellAbbildungTest {

    @Test
    fun `der Startzustand rechnet den Anteil, ohne Gesamtzahl gibt es keinen`() {
        val halb = StartupStatus(ready = false, step = "Katalog", progress = 5, total = 10).alsAnsicht()
        assertEquals(0.5f, halb.anteil!!, 0.0001f)
        assertEquals("Katalog", halb.schritt)
        assertNull("ohne Gesamtzahl gibt es keinen Anteil", StartupStatus(progress = 3, total = 0).alsAnsicht().anteil)
        assertEquals("nie über 100 %", 1f, StartupStatus(progress = 12, total = 10).alsAnsicht().anteil!!, 0f)
    }

    @Test
    fun `jede CSV-Art kommt unverändert an`() {
        for (a in CsvImportArt.entries) assertEquals(a.name, a.alsDaten().name)
        for (a in CsvArt.entries) assertEquals(a, a.alsAnsicht().alsDaten())
    }

    @Test
    fun `Preisalarm, Gutschein, Diagramm und Farbe tragen ihre Werte`() {
        val alarm = Preisalarm(setNumber = "75192-1", richtung = "unter", schwelle = 500.0).alsAnsicht()
        assertTrue(alarm.unter)
        assertFalse(Preisalarm(richtung = "ueber").alsAnsicht().unter)
        assertEquals(500.0, alarm.schwelle, 0.0)
        val g = Gutschein(id = 3, number = "6061", pin = "1", amount = 20.0, currency = "CHF").alsAnsicht()
        assertEquals(listOf(3, 20.0, "CHF"), listOf(g.id, g.amount, g.currency))
        val p = ChartPoint(xLabel = "1. Okt", value = 12.5, yFrac = 0.25).alsAnsicht()
        assertEquals(Triple("1. Okt", 12.5, 0.25), Triple(p.xLabel, p.value, p.yFrac))
        assertEquals(KEINE_FARBE, OHNE_FARBE)
    }
}
