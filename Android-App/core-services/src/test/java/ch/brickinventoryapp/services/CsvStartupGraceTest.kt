package ch.brickinventoryapp.services

import ch.brickinventoryapp.services.service.CSV_GRACE_MS
import ch.brickinventoryapp.services.service.importGoesOn
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The CSV worker starts with the upload, while the server still reports “idle”: an idle answer in
 * the first seconds is the startup, after them or after a running state it is the end.
 *
 * Counter-checks (run here): `!sawRunning &&` removed → red “after a running state …”;
 * the window to 0 → red “an idle answer at the start …”.
 */
class CsvStartupGraceTest {

    @Test
    fun `an idle answer at the start does not end the watch`() {
        assertTrue(importGoesOn(sawRunning = false, sinceStartMs = 0))
        assertTrue(importGoesOn(sawRunning = false, sinceStartMs = CSV_GRACE_MS - 1))
    }

    @Test
    fun `after the window an idle answer ends the watch`() {
        assertFalse(importGoesOn(sawRunning = false, sinceStartMs = CSV_GRACE_MS))
    }

    @Test
    fun `after a running state an idle answer is the end, also within the window`() {
        assertFalse(importGoesOn(sawRunning = true, sinceStartMs = 1_000))
    }
}
