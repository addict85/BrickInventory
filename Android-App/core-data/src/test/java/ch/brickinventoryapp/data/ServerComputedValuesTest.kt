package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.AcquisitionsResponse
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * The surfaces do not calculate — they display. Totals and key figures come from the
 * server's response, not from a loop over a (possibly filtered) list;
 * otherwise web app and app would show different numbers from the same data.
 *
 * Counter-check: in AcquisitionManagementScreen again
 * `acquisitions.sumOf { it.quantity }` inserted → the first sub-step turns
 * red; in MinifigsScreen again `figs.size` → the second.
 */
class ServerComputedValuesTest {

    private fun read(rel: String) =
        File(Sources.root, "$rel").readText()

    /** Hide comments line by line — otherwise the own explanatory text keeps the check green. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `the total row of the acquisitions comes from the server`() {
        for (f in listOf(
            "collection/ui/screens/AcquisitionManagementScreen.kt",
            "shared/ui/ManualItemComposables.kt",
        )) {
            val c = code(read(f))
            assert(!c.contains("acquisitions.sumOf")) {
                "$f sums the entries itself — the sum comes as `totals` " +
                    "from the response (utils/acquisitions.ts, acquisitionTotals)"
            }
        }
        val acq = code(read("collection/ui/screens/AcquisitionManagementScreen.kt"))
        assert(acq.contains("totals.quantity")) { "The quantity must come from totals" }
        assert(acq.contains("totals.amount")) { "The amount must come from totals" }
        // Opposite direction: `amount` is nullable, and the view must not make a
        // 0 of it — „nothing recorded“ and „bought for nothing“ are different.
        assert(acq.contains("totals.amount?.let")) {
            "The missing amount must be treated as null, not as 0"
        }
    }

    /**
     * Executed with the app's Json. Counter-check: the
     * default `= AcquisitionTotals()` removed → red.
     */
    @Test
    fun `the response carries the total, with a safe default`() {
        val newValue = BrickJson.decodeFromString(AcquisitionsResponse.serializer(),
            """{"success":true,"acquisitions":[],"totals":{"quantity":3,"amount":42.5,"priced_rows":2}}""")
        assertEquals(3, newValue.totals.quantity)
        assertEquals(42.5, newValue.totals.amount ?: 0.0, 0.0)
        // Older server versions send no total; the response does not fail because of it.
        val old = BrickJson.decodeFromString(AcquisitionsResponse.serializer(), """{"success":true,"acquisitions":[]}""")
        assertEquals(0, old.totals.quantity)
    }

    @Test
    fun `the minifigure tiles come from the server, not from the filtered list`() {
        val s = code(Sources.screen("parts/ui/screens/MinifigsScreen.kt"))
        for (pattern in listOf("figs.size", "figs.sumOf", "figs.count")) {
            assert(!s.contains(pattern)) {
                "MinifigsScreen computes the tiles from `figs` ($pattern). That list is " +
                    "filtered — the tile „entered manually\" would then always show 0."
            }
        }
        assert(s.contains("minifigStats.types") &&
               s.contains("minifigStats.totalQuantity") &&
               s.contains("minifigStats.manual")) {
            "All three tiles must come from the server metrics"
        }
    }
}
