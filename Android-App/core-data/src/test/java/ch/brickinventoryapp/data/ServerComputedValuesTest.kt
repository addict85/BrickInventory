package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.contract.AcquisitionsResponse
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

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
        File(Quellen.root, "$rel").readText()

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
                "$f summiert die Erfassungen selbst — die Summe kommt als `totals` " +
                    "aus der Antwort (utils/acquisitions.ts, acquisitionTotals)"
            }
        }
        val acq = code(read("collection/ui/screens/AcquisitionManagementScreen.kt"))
        assert(acq.contains("totals.quantity")) { "Die Menge muss aus totals kommen" }
        assert(acq.contains("totals.amount")) { "Der Betrag muss aus totals kommen" }
        // Opposite direction: `amount` is nullable, and the view must not make a
        // 0 of it — „nothing recorded" and „bought for nothing" are different.
        assert(acq.contains("totals.amount?.let")) {
            "Der fehlende Betrag muss als null behandelt werden, nicht als 0"
        }
    }

    /**
     * Executed with the app's Json. Counter-check: the
     * default `= AcquisitionTotals()` removed → red.
     */
    @Test
    fun `the response carries the total, with a safe default`() {
        val neu = BrickJson.decodeFromString(AcquisitionsResponse.serializer(),
            """{"success":true,"acquisitions":[],"totals":{"quantity":3,"amount":42.5,"priced_rows":2}}""")
        assertEquals(3, neu.totals.quantity)
        assertEquals(42.5, neu.totals.amount ?: 0.0, 0.0)
        // Older server versions send no total; the response does not fail because of it.
        val alt = BrickJson.decodeFromString(AcquisitionsResponse.serializer(), """{"success":true,"acquisitions":[]}""")
        assertEquals(0, alt.totals.quantity)
    }

    @Test
    fun `the minifigure tiles come from the server, not from the filtered list`() {
        val s = code(Quellen.bildschirm("parts/ui/screens/MinifigsScreen.kt"))
        for (pattern in listOf("figs.size", "figs.sumOf", "figs.count")) {
            assert(!s.contains(pattern)) {
                "MinifigsScreen rechnet die Kacheln aus `figs` ($pattern). Diese Liste ist " +
                    "gefiltert — die Kachel „manuell erfasst\" stünde damit immer auf 0."
            }
        }
        assert(s.contains("minifigStats.types") &&
               s.contains("minifigStats.totalQuantity") &&
               s.contains("minifigStats.manual")) {
            "Alle drei Kacheln müssen aus den Server-Kennzahlen kommen"
        }
    }
}
