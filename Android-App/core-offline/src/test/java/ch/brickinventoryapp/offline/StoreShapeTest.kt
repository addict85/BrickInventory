package ch.brickinventoryapp.offline

import ch.brickinventoryapp.contract.AccountName
import ch.brickinventoryapp.contract.BrickLinkRef
import ch.brickinventoryapp.contract.Instruction
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.WantedItem
import ch.brickinventoryapp.contract.WantedItemAlert
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.local.StockKind
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sets, wishlist items and parts lie in their own store form: every field comes
 * back unchanged, a row in the format of the server model stays readable, and an
 * unreadable row does not silently disappear.
 *
 * Counter-checks (counter-checks/store-form-fields-swapped.patch, discarded-silent.patch):
 *   in Ablagezeilen.set avg and max of the purchase price swapped → red “every field …”
 *   in OfflineStore's decode discarded = 0 → red “an unreadable row is counted …”
 */
class StoreShapeTest {

    private fun <T : Any> round(domain: Domain<T>, value: T): T = domain.form.decode(BrickJson, domain.form.encode(BrickJson, value))

    // Every field with its own value, so that a swap stands out.
    private val set = SetItem(setNumber = "10001-1", name = "Burg", year = 1990, theme = "Castle", pieces = 500, minifigs = 4, quantity = 2, imageUrl = "u", imageLocal = "l", addedAt = "2020-01-01", condition = Condition.USED,
        storage = "Kiste 1", conditions = listOf(Condition.NEW, Condition.USED), owners = listOf(AccountName(id = 3, username = "lea")), maxPurchasePrice = 99.5, avgPurchasePrice = 88.25, usedCount = 1,
        instructions = listOf(Instruction(id = 4, url = "a.pdf", description = "Heft 1", localPath = "lokal/a.pdf", isManual = true)), bricklink = BrickLinkRef(type = "GEAR", number = "g1", url = "bl", exact = false, resolved = true), priceComparisonUrl = "pv")
    private val remember = WantedItem(setNumber = "20001-1", condition = Condition.USED, createdAt = "2021-02-02", userId = 7, name = "Schiff", year = 2001, numParts = 900, imageUrl = "u", imageLocal = "l", marketPrice = 12.5,
        currency = CurrencyCode.CHF, owned = true, alarm = WantedItemAlert(direction = AlarmDirection.OVER, threshold = 30.0, triggered = true), priceComparisonUrl = "pv")
    private val part = Part(partNumber = "3001", blPartNumber = "3001b", partName = "Stein", colorId = 5, blColorId = 11, colorName = "Rot", colorHex = "FF0000", categoryName = "Steine", imageUrl = "u", imageLocal = "l", totalQuantity = 9, inSets = "10001-1", isSpare = true)

    @Test
    fun `every field of set, wishlist item and part survives the store`() {
        assertEquals(set.asView(), round(Slots.SETS, set.asView()))
        assertEquals(remember.asView(), round(Slots.WANTED_LIST, remember.asView()))
        assertEquals(part.asView(), round(Slots.PARTS, part.asView()))
        val location = StockLocationView(location = LocationEntryView(id = 3, userId = 1, name = "Keller"), default = true)
        assertEquals(location, round(Slots.STORAGE_LOCATIONS, location))
    }

    @Test
    fun `a row in the earlier format stays readable`() {
        // The server model of API v1 as JSON: this is how rows lie that were written before the own store form.
        val old = v1(BrickJson.encodeToString(SetItem.serializer(), set), "price_comparison_url" to "preisvergleich_url")
        assertEquals(set.asView(), Slots.SETS.form.decode(BrickJson, old))
        // Rows from before the English contract carry the alert under its German keys.
        val oldRemember = v1(BrickJson.encodeToString(WantedItem.serializer(), remember), "market_price" to "marktpreis",
            "currency" to "waehrung", "price_comparison_url" to "preisvergleich_url", "direction" to "richtung",
            "threshold" to "schwelle", "triggered" to "ausgeloest").replace("\"above\"", "\"ueber\"")
        assertEquals(remember.asView(), Slots.WANTED_LIST.form.decode(BrickJson, oldRemember))
        assertEquals(part.asView(), Slots.PARTS.form.decode(BrickJson, BrickJson.encodeToString(Part.serializer(), part)))
    }

    /** The JSON keys under their v1 names. */
    private fun v1(json: String, vararg keys: Pair<String, String>) =
        keys.fold(json) { t, (v2, v1) -> t.replace("\"$v2\":", "\"$v1\":") }

    @Test
    fun `an unreadable row is counted and reported instead of silently missing`() = runBlocking {
        val stock = StorageInventory()
        val messages = mutableListOf<String>()
        val store = OfflineStore(stock, OutboxStorage(), { "a" }, log = { messages += it })
        store.adopt(Slots.SETS, listOf(set.asView()))
        val intact = stock.read("a", StockKind.SETS).list
        stock.replace("a", StockKind.SETS, intact + LocalRow("kaputt", """{"quantity":"viele"}"""), 1L)
        val local = store.observe(Slots.SETS).first()
        assertEquals(listOf("10001-1"), local.list.map { it.setNumber })
        assertEquals(1, local.discarded)
        assertTrue(messages.joinToString(), messages.any { "SETS" in it && "1 von 2" in it })
    }
}
