package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.alsAbfrage
import ch.brickinventoryapp.data.api.mitSetsAlsAbfrage
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Teileliste trägt ihre Filter als Typen bis in die API-Schicht; erst dort
 * werden sie zu den Werten, die der Server liest (parts-spare, with_sets).
 *
 * Gegenprobe: gegenproben/ersatzteile-vertauscht.patch, OHNE und NUR in
 * alsAbfrage() vertauscht → rot „jede Ersatzteilwahl hat den Wert der Webapp“
 * (lokal am ausgeschnittenen TeileApi.kt gemessen).
 */
class TeileAbfrageWerteTest {

    @Test
    fun `jede Ersatzteilwahl hat den Wert der Webapp`() {
        assertEquals(
            listOf(null, "0", "1"),
            listOf(Ersatzteilwahl.ALLE, Ersatzteilwahl.OHNE, Ersatzteilwahl.NUR).map { it.alsAbfrage() },
        )
    }

    @Test
    fun `with_sets steht nur fuer die Tabelle da`() {
        assertEquals(listOf("1", null), listOf(true, false).map { mitSetsAlsAbfrage(it) })
    }
}
