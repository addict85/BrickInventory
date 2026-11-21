package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * fangeAusserAbbruch fängt Fehler wie runCatching, reicht aber das Abbrechen
 * einer Koroutine weiter: Ein abgebrochener Auftrag läuft nicht als Fehlerfall
 * weiter.
 *
 * Gegenprobe (gegenproben/abbruch-verschluckt.patch): der Zweig
 * `catch (abort: CancellationException) { throw abort }` entfernt → rot
 * „ein abgebrochener Auftrag läuft nicht weiter“ und „the cancellation goes through“.
 */
class AbortTest {

    @Test
    fun `an ordinary error becomes the result`() {
        val r = fangeAusserAbbruch { error("kaputt") }
        assertEquals("kaputt", r.exceptionOrNull()?.message)
        assertEquals(3, fangeAusserAbbruch { 3 }.getOrNull())
    }

    @Test
    fun `the cancellation goes through`() {
        var durch = false
        try {
            fangeAusserAbbruch { throw CancellationException("weg") }
        } catch (_: CancellationException) {
            durch = true
        }
        assertTrue("CancellationException wurde als Fehler verschluckt", durch)
    }

    @Test
    fun `an Error is not caught`() {
        var durch = false
        try {
            fangeAusserAbbruch { throw AssertionError("hart") }
        } catch (_: AssertionError) {
            durch = true
        }
        assertTrue("Ein Error darf nicht im Ergebnis verschwinden", durch)
    }

    @Test
    fun `a cancelled job does not keep running`() = runTest {
        val schritte = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            fangeAusserAbbruch { delay(10_000) }.onFailure { schritte += "Fehlerzweig" }
            schritte += "danach"
        }
        job.cancel()
        job.join()
        assertEquals(emptyList<String>(), schritte)
        assertTrue(job.isCancelled)
    }
}
