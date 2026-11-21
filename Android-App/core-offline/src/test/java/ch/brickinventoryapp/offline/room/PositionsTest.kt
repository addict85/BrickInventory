package ch.brickinventoryapp.offline.room

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Where a row stands after a local edit: rows that remain keep their
 * position, so that [InventoryDao.sameAn] writes only the changed ones.
 *
 * Counter-checks (kotlinc and JUnit against Positionen.kt, patches under gegenproben/):
 *   positionen-immer-neu    positionen() always counts from the start
 *                           → red „ein Loeschen in der Mitte …“ and „neue Zeilen …“
 *   positionen-davor-falsch new rows before the first remaining one start at `danach + 1`
 *                           → red „neue Zeilen nehmen freie Positionen …“ (the order shifts)
 */
class PositionsTest {

    private fun rising(p: List<Int>) = p.zipWithNext().all { (a, b) -> a < b }

    @Test
    fun `a deletion in the middle shifts nothing`() {
        assertEquals(listOf(0, 2), positionen(mapOf("a" to 0, "b" to 1, "c" to 2), listOf("a", "c")))
    }

    @Test
    fun `new rows take free positions before, between and after`() {
        val alt = mapOf("a" to 0, "c" to 2)
        val p = positionen(alt, listOf("x", "y", "a", "b", "c", "z"))
        assertEquals(listOf(-2, -1, 0, 1, 2, 3), p)
        assertTrue(rising(p))
    }

    @Test
    fun `without space or with a flipped order it renumbers`() {
        assertEquals(listOf(0, 1, 2), positionen(mapOf("a" to 0, "c" to 1), listOf("a", "b", "c")))
        assertEquals(listOf(0, 1), positionen(mapOf("a" to 0, "b" to 1), listOf("b", "a")))
        assertEquals(listOf(0, 1), positionen(emptyMap(), listOf("a", "b")))
    }
}
