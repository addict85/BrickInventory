package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.abschriftInPaaren
import ch.brickinventoryapp.ui.components.abschriftZeichen
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Das Fingerabdruckfeld setzt die Doppelpunkte selbst, wie die Webapp sie zeigt, und zählt
 * nur, was zählt; der Cursor bleibt hinter demselben getippten Zeichen.
 *
 * Gegenproben (12.11.2026, kotlinc gegen Abschriftform.kt):
 *   A  abschriftInPaaren() ohne `chunked(2).joinToString(":")` → rot „die Abschrift
 *      bekommt Doppelpunkte …“; gegenproben/abschrift-ohne-doppelpunkte.patch
 *   B  Cursor wieder `davor` (ohne die eingefügten Doppelpunkte) → rot dort
 *      („3F:A2:B“ mit Cursor 5 statt 7); gegenproben/abschrift-cursor-vor-dem-ende.patch
 */
class AbschriftformTest {

    @Test
    fun `die Abschrift bekommt Doppelpunkte, der Cursor bleibt hinter demselben Zeichen`() {
        assertEquals("3F:A2:B" to 7, abschriftInPaaren("3fa2b", 5))
        assertEquals("3F:A" to 2, abschriftInPaaren("3fa", 2))
        assertEquals("3F:A2:B" to 4, abschriftInPaaren("3F:A2B", 4))
        assertEquals("3F:A2" to 0, abschriftInPaaren(" 3f a2", 0))
        val base64 = "Hn4QkHjv0R6m0V4Qn8yJbM1C8dV2wP1o3aY6m2+qF0E="
        assertEquals("Ein eingefügtes Base64 bleibt", base64 to 3, abschriftInPaaren(base64, 3))
    }

    @Test
    fun `gezaehlt wird ohne Doppelpunkte und Leerzeichen`() {
        assertEquals(16, abschriftZeichen("AB:CD:EF:01:23:45:67:89"))
        assertEquals(4, abschriftZeichen(" 3f a2 "))
    }
}
