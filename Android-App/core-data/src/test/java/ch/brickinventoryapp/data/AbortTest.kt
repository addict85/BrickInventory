package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * catchUnlessCancelled catches errors like runCatching, but passes on the cancellation
 * of a coroutine: a cancelled job does not keep running as an error
 * case.
 *
 * Counter-check (counter-checks/abbruch-verschluckt.patch): the branch
 * `catch (abort: CancellationException) { throw abort }` removed → red
 * “a cancelled job does not keep running” and “the cancellation goes through“.
 */
class AbortTest {

    @Test
    fun `an ordinary error becomes the result`() {
        val r = catchUnlessCancelled { error("kaputt") }
        assertEquals("kaputt", r.exceptionOrNull()?.message)
        assertEquals(3, catchUnlessCancelled { 3 }.getOrNull())
    }

    @Test
    fun `the cancellation goes through`() {
        var through = false
        try {
            catchUnlessCancelled { throw CancellationException("weg") }
        } catch (_: CancellationException) {
            through = true
        }
        assertTrue("CancellationException wurde als Fehler verschluckt", through)
    }

    @Test
    fun `an Error is not caught`() {
        var through = false
        try {
            catchUnlessCancelled { throw AssertionError("hart") }
        } catch (_: AssertionError) {
            through = true
        }
        assertTrue("Ein Error darf nicht im Ergebnis verschwinden", through)
    }

    @Test
    fun `a cancelled job does not keep running`() = runTest {
        val steps = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            catchUnlessCancelled { delay(10_000) }.onFailure { steps += "Fehlerzweig" }
            steps += "danach"
        }
        job.cancel()
        job.join()
        assertEquals(emptyList<String>(), steps)
        assertTrue(job.isCancelled)
    }
}
