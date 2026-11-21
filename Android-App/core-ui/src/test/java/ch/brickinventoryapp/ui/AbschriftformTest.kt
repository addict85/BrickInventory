package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.pairTranscriptIn
import ch.brickinventoryapp.ui.components.transcriptChars
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The fingerprint field sets the colons itself, as the web app shows them, and counts
 * only what counts; the cursor stays behind the same typed character.
 *
 * Counter-checks (12.11.2026, kotlinc against Abschriftform.kt):
 *   A  pairTranscriptIn() without `chunked(2).joinToString(":")` → red „die Abschrift
 *      bekommt Doppelpunkte …“; gegenproben/abschrift-ohne-doppelpunkte.patch
 *   B  Cursor back to `before` (without the inserted colons) → red there
 *      ("3F:A2:B" with cursor at 5 instead of 7); gegenproben/abschrift-cursor-vor-dem-ende.patch
 */
class AbschriftformTest {

    @Test
    fun `the transcript gets colons, the cursor stays behind the same character`() {
        assertEquals("3F:A2:B" to 7, pairTranscriptIn("3fa2b", 5))
        assertEquals("3F:A" to 2, pairTranscriptIn("3fa", 2))
        assertEquals("3F:A2:B" to 4, pairTranscriptIn("3F:A2B", 4))
        assertEquals("3F:A2" to 0, pairTranscriptIn(" 3f a2", 0))
        val base64 = "Hn4QkHjv0R6m0V4Qn8yJbM1C8dV2wP1o3aY6m2+qF0E="
        assertEquals("Ein eingefügtes Base64 bleibt", base64 to 3, pairTranscriptIn(base64, 3))
    }

    @Test
    fun `counting ignores colons and spaces`() {
        assertEquals(16, transcriptChars("AB:CD:EF:01:23:45:67:89"))
        assertEquals(4, transcriptChars(" 3f a2 "))
    }
}
