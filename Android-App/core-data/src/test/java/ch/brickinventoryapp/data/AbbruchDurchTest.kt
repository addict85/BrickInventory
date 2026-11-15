package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Wer Fehler schluckt, schluckt das Abbrechen nicht: Ein abgebrochener Aufrufer liefe
 * sonst weiter, als wäre nichts geschehen. Geprüft wird die gemeinsame Hilfe; dass niemand
 * sie mit einem breiten Fang umgeht, hält QuelltextRatscheTest.
 *
 * Gegenproben:
 *   fang-schluckt-abbruch   fangeAusserAbbruch ohne Abbruch-Zweig → rot „fangeAusserAbbruch reicht …“
 *   start-schluckt-abbruch  ein Aufräumschritt mit `catch (_: Exception)` → rot in QuelltextRatscheTest
 */
class AbbruchDurchTest {

    private suspend fun brichtAb(block: suspend () -> Unit): Boolean =
        try { block(); false } catch (_: CancellationException) { true }

    @Test
    fun `fangeAusserAbbruch reicht das Abbrechen weiter und fängt nur Exceptions`() = runTest {
        assertTrue("fangeAusserAbbruch hat das Abbrechen verschluckt",
            brichtAb { fangeAusserAbbruch { throw CancellationException("weg") } })
        assertTrue(fangeAusserAbbruch { throw IOException("weg") }.isFailure)
        assertEquals(3, fangeAusserAbbruch { 3 }.getOrNull())
        assertTrue("ein Error darf nicht gefangen werden",
            runCatching { fangeAusserAbbruch { throw AssertionError("error") } }.exceptionOrNull() is AssertionError)
    }
}
