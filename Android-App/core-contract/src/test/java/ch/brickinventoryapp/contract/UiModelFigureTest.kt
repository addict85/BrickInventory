package ch.brickinventoryapp.contract

import ch.brickinventoryapp.contract.mapping.asData
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.Origin
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR
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
 *   A  in StartStateView.anteil the check `total > 0` removed → red
 *      “without a total there is none” (Infinity instead of null)
 *   B  in CsvImportKind.asData TEILE → CsvKind.SETS → red “every CSV kind arrives
 *      unchanged”
 *   C  in PriceAlertView.unter `== AlarmDirection.BELOW` → `OVER` → red
 *   D  main classes as a jar instead of a folder (as under Gradle): the old search via
 *      the class folder → red „URI is not hierarchical“; with the list green
 *   E  „TeileAbbildungen“ deleted from Beispielfueller.ABBILDUNGSDATEIEN → red
 *      “every file with mappings is in the list“ and „Nur 48 Abbildungen“
 *   F  in Profil.asView `emailConfirmed = emailVerified` → `= !emailVerified`
 *      → red “profile, household and CSV state …”; elternkonten from `parents` → red „ohne parents gilt linked_to“
 *   G  counter-checks/geld-auf-rappen-gerundet.patch: Geld.aus rounds to centimes instead of four places
 *      → red “amounts come as Money to four places …”
 *   H  counter-checks/kauf-ohne-zeitpunkt.patch: Acquisition.asView does not pass createdAt on → red, the same test
 *      and “every mapping carries every field of the same name unchanged“ not (filler values are no points in time)
 */
class UiModelFigureTest {

    @Test
    fun `the start state computes the share, without a total there is none`() {
        val half = StartupStatus(ready = false, step = "Katalog", progress = 5.0, total = 10).asView()
        assertEquals(0.5f, half.share!!, 0.0001f)
        assertEquals("Katalog", half.step)
        assertNull("ohne Gesamtzahl gibt es keinen Anteil", StartupStatus(progress = 3.0, total = 0).asView().share)
        assertEquals("nie über 100 %", 1f, StartupStatus(progress = 12.0, total = 10).asView().share!!, 0f)
    }

    @Test
    fun `the value history carries points, axis, days and change`() {
        val v = PortfolioHistoryResponse(success = true, currency = CurrencyCode("CHF"), periodChangePct = 2.5,
            points = listOf(ChartPoint(xLabel = "Mo", value = 1200.0, yFrac = 0.4)),
            yAxis = listOf(ChartYAxis(label = "1200", value = 1200.0, frac = 0.4)),
            chart = PriceChartData(x = listOf("2026-11-09"))).asView()
        assertEquals(CurrencyCode("CHF"), v.currency)
        assertEquals(2.5, v.changePercent!!, 0.0)
        assertEquals(Money(12_000_000), v.points.single().value)
        assertEquals("1200", v.yAxis.single().label)
        assertEquals(listOf("2026-11-09"), v.days)
    }

    @Test
    fun `amounts come as Money to four places, points in time as Instant, the origin as enumeration`() {
        val purchase = Acquisition(id = 1, quantity = 2, purchasePrice = 120.3333, createdAt = "2026-09-03T15:00:32.194Z").asView()
        assertEquals(Money(1_203_333), purchase.purchasePrice)
        assertEquals(Money(2_406_666), purchase.effectivePrice!! * 2)
        assertEquals(Instant.parse("2026-09-03T15:00:32.194Z"), purchase.createdAt)
        assertNull("kein Preis bleibt kein Preis, nicht 0", Acquisition(id = 1, quantity = 1).asView().purchasePrice)
        assertEquals("ein blosser Tag ist sein Beginn in UTC", Instant.parse("2026-09-03T00:00:00Z"),
            Acquisition(id = 1, quantity = 1, createdAt = "2026-09-03").asView().createdAt)
        assertNull("unlesbar heisst kein Zeitpunkt", Acquisition(id = 1, quantity = 1, createdAt = "gestern").asView().createdAt)
        assertEquals(Origin.MANUAL, Minifig(figNumber = "sw0001", source = "manual").asView().source)
        assertEquals(Origin.SET, Minifig(figNumber = "sw0001", source = "irgendwas").asView().source)
    }

    @Test
    fun `every CSV kind arrives unchanged`() {
        for (a in CsvImportKind.entries) assertEquals(a.name, a.asData().name)
        for (a in CsvKind.entries) assertEquals(a, a.asView().asData())
    }

    @Test
    fun `price alert, voucher, chart and color carry their values`() {
        val alarm = Preisalarm(setNumber = "75192-1", direction = AlarmDirection.BELOW, threshold = 500.0).asView()
        assertTrue(alarm.below)
        assertFalse(Preisalarm(direction = AlarmDirection.OVER).asView().below)
        assertEquals(Money(5_000_000), alarm.threshold)
        val g = Gutschein(id = 3, number = "6061", pin = "1", amount = 20.0, currency = CurrencyCode("CHF")).asView()
        assertEquals(listOf(3, Money(200_000), CurrencyCode.CHF), listOf(g.id, g.amount, g.currency))
        val p = ChartPoint(xLabel = "1. Okt", value = 12.5, yFrac = 0.25).asView()
        assertEquals(Triple("1. Okt", Money(125_000), 0.25), Triple(p.xLabel, p.value, p.yFrac))
        assertEquals(Money(12_000_000), ChartYAxis(label = "1200", value = 1200.0, frac = 0.4).asView().value)
        assertEquals(Money(7_105_000), PriceChartPoint(x = "2026-01-01", y = 710.5).asView().price)
        assertEquals(NO_COLOR, WITHOUT_COLOR)
    }

    @Test
    fun `profile, household and CSV state are prepared for the UI`() {
        assertTrue(Profil(id = 1, username = "m", emailVerified = true).asView().emailConfirmed)
        assertFalse("false heisst unbestätigt", Profil(id = 1, username = "m", emailVerified = false).asView().emailConfirmed)
        val oldField = HouseholdStatusResponse(linkedTo = KontoName(id = 7, username = "haupt")).asView()
        assertEquals("ohne parents gilt linked_to", listOf(AccountView(7, "haupt")), oldField.parentAccounts)
        val state = CsvImportStatus(status = RunStatus.RUNNING, current = "75192-1").asView()
        assertEquals(listOf(0, 0, 0, 0, 0), listOf(state.total, state.done, state.ok, state.warn, state.err))
        assertEquals(RunStatus.RUNNING, state.status)
    }

    @Test
    fun `the usage of a part carries the item as header`() {
        val v = VerwendendeSetsResponse(item = BestandteilKopf(nummer = "3001"), sets = listOf(VerwendendesSet(setNumber = "10294-1"))).asView()
        assertEquals("3001", v.header?.number)
        assertEquals(listOf("10294-1"), v.sets.map { it.setNumber })
    }

    /**
     * Every mapping `asView()` to model.fach, against a server model in which
     * every field carries its own value: every field of the view with the same
     * name arrives unchanged, nested views and lists likewise.
     * Getters without counterpart stand in [WITHOUT_COUNTERPART] and are checked individually above.
     */
    @Test
    fun `every mapping carries every field of the same name unchanged`() {
        val figures = SampleFiller.figures().filter { it.parameterTypes[0].simpleName !in OWN_RULES }
        assertTrue("Nur ${figures.size} Abbildungen gefunden — Suche veraltet?", figures.size >= 50)
        val without = sortedSetOf<String>()
        var compared = 0
        for (m in figures) {
            val dto = SampleFiller.fill(m.parameterTypes[0])
            compared += SampleFiller.compare(dto, m.invoke(null, dto), m.parameterTypes[0].simpleName, without)
        }
        assertTrue("nur $compared Felder verglichen", compared >= 300)
        assertEquals("Getter ohne Gegenstück im Server-Modell", WITHOUT_COUNTERPART, without)
    }

    @Test
    fun `every file with mappings is in the list`() {
        val folder = File("src/main/java/ch/brickinventoryapp/contract/mapping")
        val withFigure = folder.listFiles().orEmpty()
            .filter { f -> f.name.endsWith(".kt") && Regex("""fun \S+\.asView\(""").containsMatchIn(f.readText()) }
            .map { it.name.removeSuffix(".kt") }.sorted()
        assertTrue("keine Quelldatei unter ${folder.absolutePath}", withFigure.size >= 5)
        assertEquals(withFigure, SampleFiller.MAPPING_FILES.sorted())
    }

    private companion object {
        /** Mappings with their own rule (status as enumeration), checked in BackgroundWorkTest. */
        val OWN_RULES = setOf("Auftrag", "AuftraegeResponse")
        /** Deliberately renamed or derived; checked in the individual tests above. */
        val WITHOUT_COUNTERPART = sortedSetOf(
            // Parts total and breakdown, checked in PartsTotalCountTest.
            "DashboardStats.getPartsFromSets", "DashboardStats.getPartsSingle",
            "PartsStats.getPartsFromSets", "PartsStats.getPartsSingle", "PartsStats.getPartsTotal",
            "Preisalarm.getBelow", "Profil.getEmailConfirmed", "StartupStatus.getShare", "StartupStatus.getUndercut",
            "PortfolioHistoryResponse.getDays", "PortfolioHistoryResponse.getChangePercent",
            "VerwendendeSetsResponse.getHeader", "ValuationResponse.getCacheTtlHours",
            "Preisalarm.getLastlyAt", "Preisalarm.getLastlyPrice-kb79XTw", "Profil.getEmailNew",
            // The amount is named in the domain type after what it is; checked above in “price alert, voucher, chart …”.
            "PriceChartPoint.getPrice-_jXMShk",
        )
    }
}
