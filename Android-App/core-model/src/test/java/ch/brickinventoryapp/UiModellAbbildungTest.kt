package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.ChartPoint
import ch.brickinventoryapp.data.model.CsvArt
import ch.brickinventoryapp.data.model.CsvImportStatus
import ch.brickinventoryapp.data.model.HouseholdStatusResponse
import ch.brickinventoryapp.data.model.KontoName
import ch.brickinventoryapp.data.model.Profil
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.data.model.StartupStatus
import ch.brickinventoryapp.ui.model.CsvImportArt
import ch.brickinventoryapp.ui.model.KontoAnsicht
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
 *   D  Hauptklassen als Jar statt Ordner (wie unter Gradle): Die alte Suche über
 *      den Klassenordner → rot „URI is not hierarchical“; mit der Liste grün
 *   E  „TeileAnsichten“ aus Beispielfueller.ABBILDUNGSDATEIEN gestrichen → rot
 *      „jede Datei mit Abbildungen steht in der Liste“ und „Nur 48 Abbildungen“
 *   F  in Profil.alsAnsicht `emailBestaetigt = emailVerified` → `= !emailVerified`
 *      → rot „Profil, Haushalt und CSV-Stand …“ (31.10.2026 nachgemessen); elternkonten aus `parents` → rot „ohne parents gilt linked_to“
 */
class UiModellAbbildungTest {

    @Test
    fun `der Startzustand rechnet den Anteil, ohne Gesamtzahl gibt es keinen`() {
        val halb = StartupStatus(ready = false, step = "Katalog", progress = 5.0, total = 10).alsAnsicht()
        assertEquals(0.5f, halb.anteil!!, 0.0001f)
        assertEquals("Katalog", halb.schritt)
        assertNull("ohne Gesamtzahl gibt es keinen Anteil", StartupStatus(progress = 3.0, total = 0).alsAnsicht().anteil)
        assertEquals("nie über 100 %", 1f, StartupStatus(progress = 12.0, total = 10).alsAnsicht().anteil!!, 0f)
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

    @Test
    fun `Profil, Haushalt und CSV-Stand sind für die Oberfläche aufbereitet`() {
        assertTrue(Profil(id = 1, username = "m", emailVerified = true).alsAnsicht().emailBestaetigt)
        assertFalse("false heisst unbestätigt", Profil(id = 1, username = "m", emailVerified = false).alsAnsicht().emailBestaetigt)
        val altesFeld = HouseholdStatusResponse(linkedTo = KontoName(7, "haupt")).alsAnsicht()
        assertEquals("ohne parents gilt linked_to", listOf(KontoAnsicht(7, "haupt")), altesFeld.elternkonten)
        val stand = CsvImportStatus(status = "running", current = "75192-1").alsAnsicht()
        assertEquals(listOf(0, 0, 0, 0, 0), listOf(stand.total, stand.done, stand.ok, stand.warn, stand.err))
        assertEquals("running", stand.status)
    }

    /**
     * Jede Abbildung `alsAnsicht()` in ui/model, gegen ein Server-Modell, in dem
     * jedes Feld einen eigenen Wert trägt: Jedes Feld der Ansicht mit gleichem
     * Namen kommt unverändert an, verschachtelte Ansichten und Listen ebenso.
     * Getter ohne Gegenstück stehen in [OHNE_GEGENSTUECK] und sind oben einzeln geprüft.
     */
    @Test
    fun `jede Abbildung trägt jedes gleichnamige Feld unverändert`() {
        val abbildungen = Beispielfueller.abbildungen().filter { it.parameterTypes[0].simpleName !in EIGENE_REGELN }
        assertTrue("Nur ${abbildungen.size} Abbildungen gefunden — Suche veraltet?", abbildungen.size >= 50)
        val ohne = sortedSetOf<String>()
        var verglichen = 0
        for (m in abbildungen) {
            val dto = Beispielfueller.fuelle(m.parameterTypes[0])
            verglichen += Beispielfueller.vergleiche(dto, m.invoke(null, dto), m.parameterTypes[0].simpleName, ohne)
        }
        assertTrue("nur $verglichen Felder verglichen", verglichen >= 300)
        assertEquals("Getter ohne Gegenstück im Server-Modell", OHNE_GEGENSTUECK, ohne)
    }

    @Test
    fun `jede Datei mit Abbildungen steht in der Liste`() {
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui/model")
        val mitAbbildung = ordner.listFiles().orEmpty()
            .filter { f -> f.name.endsWith(".kt") && Regex("""fun \S+\.alsAnsicht\(""").containsMatchIn(f.readText()) }
            .map { it.name.removeSuffix(".kt") }.sorted()
        assertTrue("keine Quelldatei unter ${ordner.absolutePath}", mitAbbildung.size >= 5)
        assertEquals(mitAbbildung, Beispielfueller.ABBILDUNGSDATEIEN.sorted())
    }

    private companion object {
        /** Abbildungen mit eigener Regel (Status als Aufzählung), geprüft in HintergrundarbeitenTest. */
        val EIGENE_REGELN = setOf("Auftrag", "AuftraegeResponse")
        /** Bewusst umbenannt oder abgeleitet; geprüft in den Einzeltests oben. */
        val OHNE_GEGENSTUECK = sortedSetOf(
            "Preisalarm.getUnter", "Profil.getEmailBestaetigt", "StartupStatus.getAnteil", "StartupStatus.getBereit", "StartupStatus.getFortschritt",
            "StartupStatus.getGesamt", "StartupStatus.getSchritt", "StartupStatus.getUnterschritt",
        )
    }
}
