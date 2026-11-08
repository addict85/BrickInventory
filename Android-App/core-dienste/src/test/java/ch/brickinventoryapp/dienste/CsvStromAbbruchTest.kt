package ch.brickinventoryapp.dienste

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.dienste.service.folgeStrom
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Der CSV-Strom schluckt Netzfehler und fällt aufs Abfragen zurück, das Abbrechen
 * aber nicht: Ein abgebrochener Import liefe sonst weiter.
 *
 * Gegenprobe: strom-schluckt-abbruch — folgeStrom mit `catch (_: Exception)`
 *   → rot „folgeStrom reicht …“
 */
class CsvStromAbbruchTest {

    private suspend fun brichtAb(block: suspend () -> Unit): Boolean =
        try { block(); false } catch (_: CancellationException) { true }

    @Test
    fun `folgeStrom reicht das Abbrechen weiter, ein Netzfehler heisst Rueckfallebene`() = runTest {
        assertTrue("folgeStrom hat das Abbrechen verschluckt",
            brichtAb { folgeStrom(flow { throw CancellationException("weg") }) { true } })
        assertFalse(folgeStrom(flow { throw IOException("weg") }) { true })
        assertFalse(folgeStrom(flowOf(CsvImportSseClient.Event.Failed("zu"))) { true })
        val fertig = CsvImportStatus(status = "done")
        assertTrue(folgeStrom(flowOf(CsvImportSseClient.Event.Status(fertig))) { false })
    }
}
