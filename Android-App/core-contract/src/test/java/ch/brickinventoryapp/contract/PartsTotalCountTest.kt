package ch.brickinventoryapp.contract

import ch.brickinventoryapp.contract.mapping.asView
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Collection (/stats) and parts tab (/parts/stats) show the same
 * total including breakdown, like the web app („394 — 144 aus Sets · 250 einzeln“
 * ). Read from real responses of the server (state 45210d5).
 *
 * Counter-checks:
 *   A  in PartsStats.asView() `+ (manualParts ?: 0)` removed → red
 *      “parts tab and collection show the same number“ (144 instead of 394)
 *   B  in DashboardStats.asView() the fallback `?: manualParts?.let …`
 *      removed → red “without set_parts the breakdown comes from the difference”
 */
class PartsTotalCountTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun parts(text: String) = json.decodeFromString(PartsStatsResponse.serializer(), text).stats!!.asView()
    private fun stats(text: String) = json.decodeFromString(StatsResponse.serializer(), text).stats!!.asView()

    private val state = """{"total_sets":3,"total_quantity":4,"total_pieces":394,"total_instructions":0,
        "total_minifigs":0,"total_parts":394"""

    @Test
    fun `parts tab and collection show the same number`() {
        val tab = parts("""{"success":true,"stats":{"unique_parts":40,"unique_colors":9,"total_parts":144,"manual_parts":250}}""")
        val collection = stats("""{"success":true,"stats":$state,"set_parts":144,"manual_parts":250}}""")
        assertEquals(394, tab.partsTotal)
        assertEquals(collection.totalParts, tab.partsTotal)
        assertEquals(144 to 250, tab.partsFromSets to tab.partsSingle)
        assertEquals(144 to 250, collection.partsFromSets to collection.partsSingle)
    }

    @Test
    fun `without set_parts the breakdown comes from the difference`() {
        val collection = stats("""{"success":true,"stats":$state,"manual_parts":250}}""")
        assertEquals(144, collection.partsFromSets)
    }

    @Test
    fun `an older server without the fields shows the number without breakdown`() {
        val tab = parts("""{"success":true,"stats":{"unique_parts":40,"unique_colors":9,"total_parts":144}}""")
        val collection = stats("""{"success":true,"stats":$state}}""")
        assertEquals(144, tab.partsTotal)
        assertNull(tab.partsSingle)
        assertNull(collection.partsFromSets)
        assertEquals(394, DashboardStats(totalSets = 3, totalQuantity = 4, totalPieces = 394, totalInstructions = 0, totalParts = 394, totalMinifigs = 0).asView().totalParts)
    }
}
