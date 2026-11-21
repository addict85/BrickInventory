package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Whoever swallows errors does not swallow the cancellation: a cancelled caller would
 * otherwise keep running as if nothing had happened. The common helper is checked; that nobody
 * bypasses it with a broad catch is held by QuelltextRatscheTest.
 *
 * Counter-checks:
 *   fang-schluckt-abbruch   fangeAusserAbbruch without cancellation branch → red “fangeAusserAbbruch passes …”
 *   start-schluckt-abbruch  a cleanup step with `catch (_: Exception)` → red in QuelltextRatscheTest
 */
class AbortByTest {

    private suspend fun brichtAb(block: suspend () -> Unit): Boolean =
        try { block(); false } catch (_: CancellationException) { true }

    @Test
    fun `fangeAusserAbbruch passes the cancellation on and catches only exceptions`() = runTest {
        assertTrue("fangeAusserAbbruch hat das Abbrechen verschluckt",
            brichtAb { fangeAusserAbbruch { throw CancellationException("weg") } })
        assertTrue(fangeAusserAbbruch { throw IOException("weg") }.isFailure)
        assertEquals(3, fangeAusserAbbruch { 3 }.getOrNull())
        assertTrue("ein Error darf nicht gefangen werden",
            runCatching { fangeAusserAbbruch { throw AssertionError("error") } }.exceptionOrNull() is AssertionError)
    }
}
