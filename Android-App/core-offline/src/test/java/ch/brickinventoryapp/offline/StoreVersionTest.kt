package ch.brickinventoryapp.offline

import ch.brickinventoryapp.contract.AccountName
import ch.brickinventoryapp.contract.DashboardStats
import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.Minifig
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.PriceAlert
import ch.brickinventoryapp.contract.StatsResponse
import ch.brickinventoryapp.contract.ValuationAcquisition
import ch.brickinventoryapp.contract.Voucher
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogThemeView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Each compartment lives in its own row shape with a version, not as the server model: every
 * field of the compartment type survives the store, a row as it lay on disk before its own
 * shape stays readable, and an unknown version is unreadable instead of misread.
 *
 * Counter-checks (patches under counter-checks/):
 *   ablage-figur-feld-umbenannt     in MinifigRow `fig_number` without SerialName → red „eine alte Zeile …“
 *   ablage-kauf-feld-vertauscht     in the purchase store row avgPrice and purchasePrice swapped → red "every field …"
 *   ablage-fassung-ignoriert        dekodiere() reads every version with today's reader → red „eine unbekannte Fassung …“
 */
class StoreVersionTest {

    private fun <T : Any> round(domain: Domain<T>, value: T): T = domain.form.decode(BrickJson, domain.form.encode(BrickJson, value))

    private val account = AccountName(id = 3, username = "lea")
    private val purchase = ValuationAcquisition(id = 4, condition = Condition.USED, quantity = 2, purchasePrice = 1.5, avgPrice = 2.5,
        totalAvg = "5,00", valueTotal = 5.0, pnlPct = "+3%", pnlPercent = 3.0, createdAt = "2026-01-01T08:00:00Z",
        originalPurchasePrice = 1.4, purchaseCurrency = "CHF", priceEstimated = true)
    private val figure = Minifig(id = 1, inSets = "10001-1", ownerIds = listOf(3), setNumber = "10001-1", storage = "Kiste", unitPrice = 2.0,
        figNumber = "sw0001", condition = Condition.NEW, conditions = listOf(Condition.NEW), owners = listOf(account), avgPurchasePrice = 3.0,
        figName = "Luke", quantity = 2, totalQuantity = 4, imageUrl = "u", imageLocal = "l", source = "manual", setAddedAt = "2025-12-24T18:00:00Z")
    private val part = PartValuationItem(pending = true, fromCache = true, maxPrice = 9.0, minPrice = 1.0, acqCount = 2, usedCount = 1,
        categoryName = "Steine", createdAt = "2025", source = "manual", id = 5, partNumber = "3001", blPartNumber = "3001b", partName = "Stein",
        colorId = 5, colorName = "Rot", colorHex = "FF0000", quantity = 3, imageUrl = "u", imageLocal = "l", unitPrice = 0.1,
        purchasePrice = 0.3, avgPurchasePrice = 0.2, qtyAvgPrice = 0.4, avgPrice = 0.5, pnlPct = "+1%", pnlPercent = 1.0, displayValue = "1,50",
        totalValue = "1,50", valueTotal = 1.5, condition = Condition.USED, conditions = listOf(Condition.USED), userId = 3,
        owners = listOf(account), acquisitions = listOf(purchase), storage = "Regal")
    private val manualMinifig = FigValuationItem(pending = true, fromCache = true, maxPrice = 9.0, minPrice = 1.0, setNumber = "10001-1",
        source = "manual", storageId = 2, acqCount = 2, usedCount = 1, id = 6, figNumber = "sw0002", blFigNumber = "sw0002a", figName = "Leia",
        quantity = 1, imageUrl = "u", imageLocal = "l", unitPrice = 1.0, purchasePrice = 2.0, avgPurchasePrice = 3.0, qtyAvgPrice = 4.0,
        avgPrice = 5.0, pnlPct = "-1%", pnlPercent = -1.0, displayValue = "5,00", totalValue = "5,00", valueTotal = 5.0,
        condition = Condition.NEW, conditions = listOf(Condition.NEW), userId = 3, owners = listOf(account), acquisitions = listOf(purchase), storage = "Kiste")
    private val voucher = Voucher(id = 7, number = "6061", amount = 20.0, currency = CurrencyCode.EUR, hasPdf = true,
        createdAt = "2025-05-01T09:00:00Z", updatedAt = "2026-01-01T09:00:00Z", balanceCheckedAt = "2026-02-03")
    private val alarm = PriceAlert(setNumber = "75192-1", condition = Condition.USED, direction = AlarmDirection.OVER, threshold = 800.0,
        currencyCode = CurrencyCode.CHF, triggered = true, lastTriggeredAt = "2026-03-04T05:06:07Z", lastPrice = 810.0, name = "Falke", imageLocal = "l",
        imageUrl = "u", setImgUrl = "s", owns = false)
    private val metrics = StatsResponse(success = true, stats = DashboardStats(currency = "CHF", defaultCondition = "N",
        userDefaultCondition = "U", totalSets = 1, totalQuantity = 2, totalPieces = 3, totalInstructions = 4, totalParts = 5, setParts = 6,
        manualParts = 7, totalMinifigs = 8))
    private val metaView = CatalogMetaView(listOf(CatalogThemeView(id = 1, name = "Castle", setCount = 9)), 1980, 2026)

    @Test
    fun `every field of every compartment survives the store`() {
        // The filler values are readable timestamps: a null would outlive every store.
        listOf(figure.asView().setAddedAt, purchase.asView().createdAt, voucher.asView().balanceCheckedAt, alarm.asView().lastlyAt)
            .forEach { assertNotNull(it) }
        assertEquals(figure.asView(), round(Slots.FIGURES, figure.asView()))
        assertEquals(part.asView(), round(Slots.MANUAL_PARTS, part.asView()))
        assertEquals(manualMinifig.asView(), round(Slots.MANUAL_FIGURES, manualMinifig.asView()))
        assertEquals(voucher.asView(), round(Slots.VOUCHERS, voucher.asView()))
        assertEquals(alarm.asView(), round(Slots.PRICE_ALARMS, alarm.asView()))
        assertEquals(metrics.stats!!.asView(), round(Slots.METRICS, metrics.stats!!.asView()))
        assertEquals(metaView, round(Slots.CATALOG_META, metaView))
    }

    @Test
    fun `the PIN of a voucher does not get onto the disk`() {
        val text = Slots.VOUCHERS.form.encode(BrickJson, voucher.copy(pin = "4711").asView())
        assertEquals(false, "4711" in text)
    }

    /** How the rows lay when the store still wrote the server model: frozen, not newly generated. */
    @Test
    fun `an old row of every compartment stays readable`() {
        assertEquals(Minifig(figNumber = "sw0001", figName = "Luke", quantity = 2, owners = listOf(account)).asView(),
            Slots.FIGURES.form.decode(BrickJson,
                """{"fig_number":"sw0001","fig_name":"Luke","quantity":2,"owners":[{"id":3,"username":"lea"}],"source":"set"}"""))
        assertEquals(PartValuationItem(partNumber = "3001", colorId = 5, quantity = 3, userId = 3, storage = "Regal",
            acquisitions = listOf(ValuationAcquisition(id = 4, purchasePrice = 1.5))).asView(),
            Slots.MANUAL_PARTS.form.decode(BrickJson,
                """{"part_number":"3001","color_id":5,"quantity":3,"user_id":3,"storage":"Regal","acquisitions":[{"id":4,"purchase_price":1.5}]}"""))
        assertEquals(FigValuationItem(figNumber = "sw0002", blFigNumber = "sw0002a", quantity = 1, userId = 3).asView(),
            Slots.MANUAL_FIGURES.form.decode(BrickJson, """{"fig_number":"sw0002","bl_fig_number":"sw0002a","quantity":1,"user_id":3}"""))
        assertEquals(Voucher(id = 7, number = "6061", amount = 20.0, currency = CurrencyCode.EUR, hasPdf = true).asView(),
            Slots.VOUCHERS.form.decode(BrickJson, """{"id":7,"number":"6061","amount":20.0,"currency":"EUR","hat_pdf":true}"""))
        assertEquals(PriceAlert(setNumber = "75192-1", condition = Condition.USED, direction = AlarmDirection.OVER, threshold = 800.0,
            currencyCode = CurrencyCode.CHF, lastPrice = 810.0).asView(),
            Slots.PRICE_ALARMS.form.decode(BrickJson,
                """{"set_number":"75192-1","condition":"U","richtung":"ueber","schwelle":800.0,"currency_code":"CHF","zuletzt_preis":810.0}"""))
        assertEquals(DashboardStats(totalSets = 1, totalQuantity = 2, totalPieces = 3,
            totalInstructions = 4, totalParts = 5, manualParts = 7, totalMinifigs = 8).asView(),
            Slots.METRICS.form.decode(BrickJson, """{"success":true,"stats":{"total_sets":1,"total_quantity":2,"total_pieces":3,""" +
                """"total_instructions":4,"total_parts":5,"manual_parts":7,"total_minifigs":8}}"""))
        assertEquals(CatalogMetaView(listOf(CatalogThemeView(id = 1, name = "Castle", setCount = 9)), 1980, null),
            Slots.CATALOG_META.form.decode(BrickJson, """{"success":true,"themes":[{"id":1,"name":"Castle","set_count":9}],"year_min":1980}"""))
    }

    @Test
    fun `an unknown version is unreadable instead of misread`() {
        val newValue = """{"fassung":2,"fig_number":"sw0001"}"""
        assertThrows(SerializationException::class.java) { Slots.FIGURES.form.decode(BrickJson, newValue) }
        assertEquals("version 1 carries no field", "sw0001", Slots.FIGURES.form.decode(BrickJson, """{"fassung":1,"fig_number":"sw0001"}""").figNumber)
    }
}
