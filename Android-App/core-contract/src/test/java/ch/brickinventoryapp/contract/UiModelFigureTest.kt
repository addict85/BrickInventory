package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Herkunft
import ch.brickinventoryapp.model.domain.Laufstatus
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.contract.mapping.asData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * The mappings of server models to domain types (model.fach): what the
 * UI gets is already prepared — shares computed, direction as a
 * boolean, the CSV kind there and back without loss.
 *
 * Counter-checks:
 *   A  in StartStateView.anteil the check `gesamt > 0` removed → red
 *      “without a total there is none” (Infinity instead of null)
 *   B  in CsvImportKind.asData TEILE → CsvKind.SETS → red “every CSV kind arrives
 *      unchanged”
 *   C  in PriceAlertView.unter `== Alarmrichtung.UNTER` → `UEBER` → red
 *   D  main classes as a jar instead of a folder (as under Gradle): the old search via
 *      the class folder → red „URI is not hierarchical“; with the list green
 *   E  „TeileAbbildungen“ deleted from Beispielfueller.ABBILDUNGSDATEIEN → red
 *      “every file with mappings is in the list“ and „Nur 48 Abbildungen“
 *   F  in Profil.alsAnsicht `emailConfirmed = emailVerified` → `= !emailVerified`
 *      → red “profile, household and CSV state …”; elternkonten from `parents` → red „ohne parents gilt linked_to“
 *   G  gegenproben/geld-auf-rappen-gerundet.patch: Geld.aus rounds to centimes instead of four places
 *      → red “amounts come as Money to four places …”
 *   H  gegenproben/kauf-ohne-zeitpunkt.patch: Acquisition.alsAnsicht does not pass createdAt on → red, the same test
 *      and “every mapping carries every field of the same name unchanged“ not (filler values are no points in time)
 */
class UiModelFigureTest {

    @Test
    fun `the start state computes the share, without a total there is none`() {
        val half = StartupStatus(ready = false, step = "Katalog", progress = 5.0, total = 10).alsAnsicht()
        assertEquals(0.5f, half.share!!, 0.0001f)
        assertEquals("Katalog", half.schritt)
        assertNull("ohne Gesamtzahl gibt es keinen Anteil", StartupStatus(progress = 3.0, total = 0).alsAnsicht().share)
        assertEquals("nie über 100 %", 1f, StartupStatus(progress = 12.0, total = 10).alsAnsicht().share!!, 0f)
    }

    @Test
    fun `the value history carries points, axis, days and change`() {
        val v = PortfolioHistoryResponse(success = true, currency = Waehrung("CHF"), periodChangePct = 2.5,
            points = listOf(ChartPoint(xLabel = "Mo", value = 1200.0, yFrac = 0.4)),
            yAxis = listOf(ChartYAxis(label = "1200", value = 1200.0, frac = 0.4)),
            chart = PriceChartData(x = listOf("2026-11-09"))).alsAnsicht()
        assertEquals(Waehrung("CHF"), v.waehrung)
        assertEquals(2.5, v.changePercent!!, 0.0)
        assertEquals(Geld(12_000_000), v.punkte.single().wert)
        assertEquals("1200", v.yAchse.single().label)
        assertEquals(listOf("2026-11-09"), v.days)
    }

    @Test
    fun `amounts come as Money to four places, points in time as Instant, the origin as enumeration`() {
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
    fun `every CSV kind arrives unchanged`() {
        for (a in CsvImportKind.entries) assertEquals(a.name, a.asData().name)
        for (a in CsvKind.entries) assertEquals(a, a.alsAnsicht().asData())
    }

    @Test
    fun `price alert, voucher, chart and color carry their values`() {
        val alarm = Preisalarm(setNumber = "75192-1", direction = Alarmrichtung.UNTER, threshold = 500.0).alsAnsicht()
        assertTrue(alarm.unter)
        assertFalse(Preisalarm(direction = Alarmrichtung.UEBER).alsAnsicht().unter)
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
    fun `profile, household and CSV state are prepared for the UI`() {
        assertTrue(Profil(id = 1, username = "m", emailVerified = true).alsAnsicht().emailConfirmed)
        assertFalse("false heisst unbestätigt", Profil(id = 1, username = "m", emailVerified = false).alsAnsicht().emailConfirmed)
        val oldField = HouseholdStatusResponse(linkedTo = KontoName(id = 7, username = "haupt")).alsAnsicht()
        assertEquals("ohne parents gilt linked_to", listOf(AccountView(7, "haupt")), oldField.elternkonten)
        val stand = CsvImportStatus(status = Laufstatus.LAEUFT, current = "75192-1").alsAnsicht()
        assertEquals(listOf(0, 0, 0, 0, 0), listOf(stand.total, stand.done, stand.ok, stand.warn, stand.err))
        assertEquals(Laufstatus.LAEUFT, stand.status)
    }

    @Test
    fun `the usage of a part carries the item as header`() {
        val v = VerwendendeSetsResponse(item = BestandteilKopf(nummer = "3001"), sets = listOf(VerwendendesSet(setNumber = "10294-1"))).alsAnsicht()
        assertEquals("3001", v.kopf?.nummer)
        assertEquals(listOf("10294-1"), v.sets.map { it.setNumber })
    }

    /**
     * Every mapping `alsAnsicht()` to model.fach, against a server model in which
     * every field carries its own value: every field of the view with the same
     * name arrives unchanged, nested views and lists likewise.
     * Getters without counterpart stand in [WITHOUT_COUNTERPART] and are checked individually above.
     */
    @Test
    fun `every mapping carries every field of the same name unchanged`() {
        val figures = Beispielfueller.figures().filter { it.parameterTypes[0].simpleName !in OWN_RULES }
        assertTrue("Nur ${figures.size} Abbildungen gefunden — Suche veraltet?", figures.size >= 50)
        val ohne = sortedSetOf<String>()
        var verglichen = 0
        for (m in figures) {
            val dto = Beispielfueller.fill(m.parameterTypes[0])
            verglichen += Beispielfueller.compare(dto, m.invoke(null, dto), m.parameterTypes[0].simpleName, ohne)
        }
        assertTrue("nur $verglichen Felder verglichen", verglichen >= 300)
        assertEquals("Getter ohne Gegenstück im Server-Modell", WITHOUT_COUNTERPART, ohne)
    }

    @Test
    fun `every file with mappings is in the list`() {
        val folder = File("src/main/java/ch/brickinventoryapp/contract/mapping")
        val withFigure = folder.listFiles().orEmpty()
            .filter { f -> f.name.endsWith(".kt") && Regex("""fun \S+\.alsAnsicht\(""").containsMatchIn(f.readText()) }
            .map { it.name.removeSuffix(".kt") }.sorted()
        assertTrue("keine Quelldatei unter ${folder.absolutePath}", withFigure.size >= 5)
        assertEquals(withFigure, Beispielfueller.ABBILDUNGSDATEIEN.sorted())
    }

    private companion object {
        /** Mappings with their own rule (status as enumeration), checked in BackgroundWorkTest. */
        val OWN_RULES = setOf("Auftrag", "AuftraegeResponse")
        /** Deliberately renamed or derived; checked in the individual tests above. */
        val WITHOUT_COUNTERPART = sortedSetOf(
            // Parts total and breakdown, checked in PartsTotalCountTest.
            "DashboardStats.getPartsFromSets", "DashboardStats.getPartsSingle",
            "PartsStats.getPartsFromSets", "PartsStats.getPartsSingle", "PartsStats.getTeileGesamt",
            "Preisalarm.getUnter", "Profil.getEmailConfirmed", "StartupStatus.getShare", "StartupStatus.getBereit", "StartupStatus.getFortschritt",
            "StartupStatus.getGesamt", "StartupStatus.getSchritt", "StartupStatus.getUndercut",
            "PortfolioHistoryResponse.getPunkte", "PortfolioHistoryResponse.getDays", "PortfolioHistoryResponse.getChangePercent",
            "PortfolioHistoryResponse.getWaehrung-OjGCfcU", "PortfolioHistoryResponse.getYAchse",
            "VerwendendeSetsResponse.getKopf",
            // The contract is English since Phase 1, the UI models still carry the German names.
            "MerkpostenAlarm.getAusgeloest", "MerkpostenAlarm.getRichtung", "MerkpostenAlarm.getSchwelle-lC1rhjU",
            "Preisalarm.getAusgeloest", "Preisalarm.getRichtung", "Preisalarm.getSchwelle-lC1rhjU",
            "Preisalarm.getLastlyAt", "Preisalarm.getLastlyPrice-gIeASGk", "Profil.getEmailNew",
            // The amount is named in the domain type after what it is; checked above in “price alert, voucher, chart …”.
            "ChartPoint.getWert-lC1rhjU", "ChartYAxis.getWert-lC1rhjU", "PriceChartPoint.getPreis-lC1rhjU",
        )
    }
}
