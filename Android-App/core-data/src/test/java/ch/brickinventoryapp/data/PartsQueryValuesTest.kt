package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.asQuery
import ch.brickinventoryapp.data.api.withSetsAsQuery
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Teileliste trägt ihre Filter als Typen bis in die API-Schicht; erst dort
 * werden sie zu den Werten, die der Server liest (parts-spare, with_sets).
 *
 * Gegenprobe: gegenproben/ersatzteile-vertauscht.patch, OHNE und NUR in
 * asQuery() vertauscht → rot „every spare part choice has the web app's value“
 * (lokal am ausgeschnittenen PartsApi.kt gemessen).
 */
class PartsQueryValuesTest {

    @Test
    fun `every spare part choice has the web app's value`() {
        assertEquals(
            listOf(null, "0", "1"),
            listOf(Ersatzteilwahl.ALLE, Ersatzteilwahl.OHNE, Ersatzteilwahl.NUR).map { it.asQuery() },
        )
    }

    @Test
    fun `with_sets is there only for the table`() {
        assertEquals(listOf("1", null), listOf(true, false).map { withSetsAsQuery(it) })
    }
}
