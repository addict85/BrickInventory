package ch.brickinventoryapp.offline.room

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wo eine Zeile nach einer lokalen Bearbeitung steht: Bleibende Zeilen behalten ihre
 * Position, damit [BestandDao.gleicheAn] nur die geänderten schreibt.
 *
 * Gegenproben (kotlinc und JUnit gegen Positionen.kt, Patches unter gegenproben/):
 *   positionen-immer-neu    positionen() zählt immer von vorn
 *                           → rot „ein Loeschen in der Mitte …“ und „neue Zeilen …“
 *   positionen-davor-falsch neue Zeilen vor der ersten bleibenden ab `danach + 1`
 *                           → rot „neue Zeilen nehmen freie Positionen …“ (die Reihenfolge kippt)
 */
class PositionenTest {

    private fun steigend(p: List<Int>) = p.zipWithNext().all { (a, b) -> a < b }

    @Test
    fun `ein Loeschen in der Mitte verschiebt nichts`() {
        assertEquals(listOf(0, 2), positionen(mapOf("a" to 0, "b" to 1, "c" to 2), listOf("a", "c")))
    }

    @Test
    fun `neue Zeilen nehmen freie Positionen davor, dazwischen und dahinter`() {
        val alt = mapOf("a" to 0, "c" to 2)
        val p = positionen(alt, listOf("x", "y", "a", "b", "c", "z"))
        assertEquals(listOf(-2, -1, 0, 1, 2, 3), p)
        assertTrue(steigend(p))
    }

    @Test
    fun `ohne Platz oder bei gekippter Reihenfolge wird durchgezaehlt`() {
        assertEquals(listOf(0, 1, 2), positionen(mapOf("a" to 0, "c" to 1), listOf("a", "b", "c")))
        assertEquals(listOf(0, 1), positionen(mapOf("a" to 0, "b" to 1), listOf("b", "a")))
        assertEquals(listOf(0, 1), positionen(emptyMap(), listOf("a", "b")))
    }
}
