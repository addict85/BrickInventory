package ch.brickinventoryapp.services

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.services.service.followStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * The CSV stream swallows network errors and falls back to polling, but not
 * cancellation: a cancelled import would otherwise keep running.
 *
 * Counter-check: strom-schluckt-abbruch — followStream with `catch (_: Exception)`
 *   → red „followStream reicht …“
 */
class CsvStreamAbortTest {

    private suspend fun aborts(block: suspend () -> Unit): Boolean =
        try { block(); false } catch (_: CancellationException) { true }

    @Test
    fun `followStream passes the cancellation on, a network error means fallback level`() = runTest {
        assertTrue("folgeStrom hat das Abbrechen verschluckt",
            aborts { followStream(flow { throw CancellationException("weg") }) { true } })
        assertFalse(followStream(flow { throw IOException("weg") }) { true })
        assertFalse(followStream(flowOf(CsvImportSseClient.Event.Failed("zu"))) { true })
        val done = CsvImportStatusView(status = RunStatus.DONE)
        assertTrue(followStream(flowOf(CsvImportSseClient.Event.Status(done))) { false })
    }
}
