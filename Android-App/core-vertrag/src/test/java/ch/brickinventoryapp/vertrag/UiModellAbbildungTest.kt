package ch.brickinventoryapp.vertrag

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Herkunft
import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.CsvImportArt
import ch.brickinventoryapp.model.fach.KontoAnsicht
import ch.brickinventoryapp.model.fach.OHNE_FARBE
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsDaten
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * Die Abbildungen von Server-Modellen auf Fachtypen (model.fach): Was die
 * Oberfläche bekommt, ist schon aufbereitet — Anteile gerechnet, Richtung als
 * Wahrheitswert, die CSV-Art hin und zurück verlustfrei.
 *
 * Gegenproben:
 *   A  in StartzustandAnsicht.anteil die Prüfung `gesamt > 0` entfernt → rot
 *      „ohne Gesamtzahl gibt es keinen Anteil“ (Infinity statt null)
 *   B  in CsvImportArt.alsDaten TEILE → CsvArt.SETS → rot „jede CSV-Art kommt
 *      unverändert an“
 *   C  in PreisalarmAnsicht.unter `== Alarmrichtung.UNTER` → `UEBER` → rot
 *   D  Hauptklassen als Jar statt Ordner (wie unter Gradle): Die alte Suche über
 *      den Klassenordner → rot „URI is not hierarchical“; mit der Liste grün
 *   E  „TeileAbbildungen“ aus Beispielfueller.ABBILDUNGSDATEIEN gestrichen → rot
 *      „jede Datei mit Abbildungen steht in der Liste“ und „Nur 48 Abbildungen“
 *   F  in Profil.alsAnsicht `emailBestaetigt = emailVerified` → `= !emailVerified`
 *      → rot „Profil, Haushalt und CSV-Stand …“; elternkonten aus `parents` → rot „ohne parents gilt linked_to“
 *   G  gegenproben/geld-auf-rappen-gerundet.patch: Geld.aus rundet auf Rappen statt auf vier Stellen
 *      → rot „Betraege kommen als Geld auf vier Stellen …“
 *   H  gegenproben/kauf-ohne-zeitpunkt.patch: Acquisition.alsAnsicht reicht createdAt nicht weiter → rot, derselbe Test
 *      und „jede Abbildung trägt jedes gleichnamige Feld unverändert“ nicht (Füllwerte sind keine Zeitpunkte)
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
    fun `der Wertverlauf traegt Punkte, Achse, Tage und Veraenderung`() {
        val v = PortfolioHistoryResponse(success = true, currency = Waehrung("CHF"), periodChangePct = 2.5,
            points = listOf(ChartPoint(xLabel = "Mo", value = 1200.0, yFrac = 0.4)),
            yAxis = listOf(ChartYAxis(label = "1200", value = 1200.0, frac = 0.4)),
            chart = PriceChartData(x = listOf("2026-11-09"))).alsAnsicht()
        assertEquals(Waehrung("CHF"), v.waehrung)
        assertEquals(2.5, v.veraenderungProzent!!, 0.0)
        assertEquals(Geld(12_000_000), v.punkte.single().wert)
        assertEquals("1200", v.yAchse.single().label)
        assertEquals(listOf("2026-11-09"), v.tage)
    }

    @Test
    fun `Betraege kommen als Geld auf vier Stellen, Zeitpunkte als Instant, die Herkunft als Aufzaehlung`() {
        val kauf = Acquisition(id = 1, quantity = 2, purchasePrice = 120.3333, createdAt = "2026-09-03T15:00:32.194Z").alsAnsicht()
        assertEquals(Geld(1_203_333), kauf.purchasePrice)
        assertEquals(Geld(2_406_666), kauf.effectivePrice!! * 2)
        assertEquals(Instant.parse("2026-09-03T15:00:32.194Z"), kauf.createdAt)
        assertNull("kein Preis bleibt kein Preis, nicht 0", Acquisition(id = 1, quantity = 1).alsAnsicht().purchasePrice)
        assertEquals("ein blosser Tag ist sein Beginn in UTC", Instant.parse("2026-09-03T00:00:00Z"),
            Acquisition(id = 1, quantity = 1, createdAt = "2026-09-03").alsAnsicht().createdAt)
        assertNull("unlesbar heisst kein Zeitpunkt", Acquisition(id = 1, quantity = 1, createdAt = "gestern").alsAnsicht().createdAt)
        assertEquals(Herkunft.MANUELL, Minifig(figNumber = "sw0001", source = "manual").alsAnsicht().source)
        assertEquals(Herkunft.SET, Minifig(figNumber = "sw0001", source = "irgendwas").alsAnsicht().source)
    }

    @Test
    fun `jede CSV-Art kommt unverändert an`() {
        for (a in CsvImportArt.entries) assertEquals(a.name, a.alsDaten().name)
        for (a in CsvArt.entries) assertEquals(a, a.alsAnsicht().alsDaten())
    }

    @Test
    fun `Preisalarm, Gutschein, Diagramm und Farbe tragen ihre Werte`() {
        val alarm = Preisalarm(setNumber = "75192-1", richtung = Alarmrichtung.UNTER, schwelle = 500.0).alsAnsicht()
        assertTrue(alarm.unter)
        assertFalse(Preisalarm(richtung = Alarmrichtung.UEBER).alsAnsicht().unter)
        assertEquals(Geld(5_000_000), alarm.schwelle)
        val g = Gutschein(id = 3, number = "6061", pin = "1", amount = 20.0, currency = Waehrung("CHF")).alsAnsicht()
        assertEquals(listOf(3, Geld(200_000), Waehrung.CHF), listOf(g.id, g.amount, g.currency))
        val p = ChartPoint(xLabel = "1. Okt", value = 12.5, yFrac = 0.25).alsAnsicht()
        assertEquals(Triple("1. Okt", Geld(125_000), 0.25), Triple(p.xLabel, p.wert, p.yFrac))
        assertEquals(Geld(12_000_000), ChartYAxis(label = "1200", value = 1200.0, frac = 0.4).alsAnsicht().wert)
        assertEquals(Geld(7_105_000), PriceChartPoint(x = "2026-01-01", y = 710.5).alsAnsicht().preis)
        assertEquals(KEINE_FARBE, OHNE_FARBE)
    }

    @Test
    fun `Profil, Haushalt und CSV-Stand sind für die Oberfläche aufbereitet`() {
        assertTrue(Profil(id = 1, username = "m", emailVerified = true).alsAnsicht().emailBestaetigt)
        assertFalse("false heisst unbestätigt", Profil(id = 1, username = "m", emailVerified = false).alsAnsicht().emailBestaetigt)
        val altesFeld = HouseholdStatusResponse(linkedTo = KontoName(id = 7, username = "haupt")).alsAnsicht()
        assertEquals("ohne parents gilt linked_to", listOf(KontoAnsicht(7, "haupt")), altesFeld.elternkonten)
        val stand = CsvImportStatus(status = Laufstatus.LAEUFT, current = "75192-1").alsAnsicht()
        assertEquals(listOf(0, 0, 0, 0, 0), listOf(stand.total, stand.done, stand.ok, stand.warn, stand.err))
        assertEquals(Laufstatus.LAEUFT, stand.status)
    }

    @Test
    fun `die Verwendung eines Teils traegt den Posten als Kopf`() {
        val v = VerwendendeSetsResponse(item = BestandteilKopf(nummer = "3001"), sets = listOf(VerwendendesSet(setNumber = "10294-1"))).alsAnsicht()
        assertEquals("3001", v.kopf?.nummer)
        assertEquals(listOf("10294-1"), v.sets.map { it.setNumber })
    }

    /**
     * Jede Abbildung `alsAnsicht()` nach model.fach, gegen ein Server-Modell, in dem
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
        val ordner = File("src/main/java/ch/brickinventoryapp/vertrag/abbildung")
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
            // Teile-Gesamtzahl und Aufschlüsselung, geprüft in TeileGesamtzahlTest.
            "DashboardStats.getTeileAusSets", "DashboardStats.getTeileEinzeln",
            "PartsStats.getTeileAusSets", "PartsStats.getTeileEinzeln", "PartsStats.getTeileGesamt",
            "Preisalarm.getUnter", "Profil.getEmailBestaetigt", "StartupStatus.getAnteil", "StartupStatus.getBereit", "StartupStatus.getFortschritt",
            "StartupStatus.getGesamt", "StartupStatus.getSchritt", "StartupStatus.getUnterschritt",
            "PortfolioHistoryResponse.getPunkte", "PortfolioHistoryResponse.getTage", "PortfolioHistoryResponse.getVeraenderungProzent",
            "PortfolioHistoryResponse.getWaehrung-lSQNSqI", "PortfolioHistoryResponse.getYAchse",
            "VerwendendeSetsResponse.getKopf",
            // Der Betrag heisst im Fachtyp nach dem, was er ist; geprüft oben in „Preisalarm, Gutschein, Diagramm …“.
            "ChartPoint.getWert-Zm0ExB4", "ChartYAxis.getWert-Zm0ExB4", "PriceChartPoint.getPreis-Zm0ExB4",
        )
    }
}
