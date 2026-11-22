package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.asQuery
import ch.brickinventoryapp.data.api.withSetsAsQuery
import ch.brickinventoryapp.model.data.SparePartChoice
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The parts list carries its filters as types into the API layer; only there
 * do they become the values the server reads (parts-spare, with_sets).
 *
 * Counter-check: counter-checks/ersatzteile-vertauscht.patch, OHNE and NUR swapped in
 * asQuery() → red “every spare part choice has the web app's value”
 * (measured locally on the cut-out PartsApi.kt).
 */
class PartsQueryValuesTest {

    @Test
    fun `every spare part choice has the web app's value`() {
        assertEquals(
            listOf(null, "0", "1"),
            listOf(SparePartChoice.ALL, SparePartChoice.WITHOUT, SparePartChoice.ONLY).map { it.asQuery() },
        )
    }

    @Test
    fun `with_sets is there only for the table`() {
        assertEquals(listOf("1", null), listOf(true, false).map { withSetsAsQuery(it) })
    }
}
