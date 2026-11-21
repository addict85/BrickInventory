package ch.brickinventoryapp.contract

import ch.brickinventoryapp.contract.mapping.alsAnsicht
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Collection (/stats) and parts tab (/parts/stats) show the same
 * total including breakdown, like the web app („394 — 144 aus Sets · 250
 * einzeln“). Read from real responses of the server (state 45210d5).
 *
 * Counter-checks:
 *   A  in PartsStats.alsAnsicht() `+ (manualParts ?: 0)` removed → red
 *      “parts tab and collection show the same number“ (144 instead of 394)
 *   B  in DashboardStats.alsAnsicht() the fallback `?: manualParts?.let …`
 *      removed → red “without set_parts the breakdown comes from the difference”
 */
class PartsTotalCountTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun teile(text: String) = json.decodeFromString(PartsStatsResponse.serializer(), text).stats!!.alsAnsicht()
    private fun stats(text: String) = json.decodeFromString(StatsResponse.serializer(), text).stats!!.alsAnsicht()

    private val stand = """{"total_sets":3,"total_quantity":4,"total_pieces":394,"total_instructions":0,
        "total_minifigs":0,"total_parts":394"""

    @Test
    fun `parts tab and collection show the same number`() {
        val tab = teile("""{"success":true,"stats":{"unique_parts":40,"unique_colors":9,"total_parts":144,"manual_parts":250}}""")
        val sammlung = stats("""{"success":true,"stats":$stand,"set_parts":144,"manual_parts":250}}""")
        assertEquals(394, tab.teileGesamt)
        assertEquals(sammlung.totalParts, tab.teileGesamt)
        assertEquals(144 to 250, tab.partsFromSets to tab.partsSingle)
        assertEquals(144 to 250, sammlung.partsFromSets to sammlung.partsSingle)
    }

    @Test
    fun `without set_parts the breakdown comes from the difference`() {
        val sammlung = stats("""{"success":true,"stats":$stand,"manual_parts":250}}""")
        assertEquals(144, sammlung.partsFromSets)
    }

    @Test
    fun `an older server without the fields shows the number without breakdown`() {
        val tab = teile("""{"success":true,"stats":{"unique_parts":40,"unique_colors":9,"total_parts":144}}""")
        val sammlung = stats("""{"success":true,"stats":$stand}}""")
        assertEquals(144, tab.teileGesamt)
        assertNull(tab.partsSingle)
        assertNull(sammlung.partsFromSets)
        assertEquals(394, DashboardStats(totalSets = 3, totalQuantity = 4, totalPieces = 394, totalInstructions = 0, totalParts = 394, totalMinifigs = 0).alsAnsicht().totalParts)
    }
}
