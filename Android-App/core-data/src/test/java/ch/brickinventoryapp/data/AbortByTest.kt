package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Whoever swallows errors does not swallow the cancellation: a cancelled caller would
 * otherwise keep running as if nothing had happened. The common helper is checked; that nobody
 * bypasses it with a broad catch is held by SourceRatchetTest.
 *
 * Counter-checks:
 *   fang-schluckt-abbruch   catchUnlessCancelled without cancellation branch → red “catchUnlessCancelled passes …”
 *   start-schluckt-abbruch  a cleanup step with `catch (_: Exception)` → red in SourceRatchetTest
 */
class AbortByTest {

    private suspend fun aborts(block: suspend () -> Unit): Boolean =
        try { block(); false } catch (_: CancellationException) { true }

    @Test
    fun `catchUnlessCancelled passes the cancellation on and catches only exceptions`() = runTest {
        assertTrue("catchUnlessCancelled swallowed the cancellation",
            aborts { catchUnlessCancelled { throw CancellationException("weg") } })
        assertTrue(catchUnlessCancelled { throw IOException("weg") }.isFailure)
        assertEquals(3, catchUnlessCancelled { 3 }.getOrNull())
        assertTrue("an Error must not be caught",
            runCatching { catchUnlessCancelled { throw AssertionError("error") } }.exceptionOrNull() is AssertionError)
    }
}
