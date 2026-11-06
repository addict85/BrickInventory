package ch.brickinventoryapp

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.CsvImportStatus
import ch.brickinventoryapp.service.folgeStrom
import ch.brickinventoryapp.util.fangeAusserAbbruch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

/**
 * Antwort-Cache und CSV-Strom schlucken Fehler, das Abbrechen aber nicht: Ein
 * abgebrochener Aufrufer liefe sonst weiter, als wäre nichts geschehen. Der Cache
 * fängt über fangeAusserAbbruch; kotlinx-serialization verpackt Ausnahmen aus einem
 * Serializer, deshalb wird die Hilfe selbst geprüft und am Cache nur das Schlucken.
 *
 * Gegenproben:
 *   fang-schluckt-abbruch   fangeAusserAbbruch ohne Abbruch-Zweig → rot „fangeAusserAbbruch reicht …“
 *   strom-schluckt-abbruch  folgeStrom mit `catch (_: Exception)`  → rot „folgeStrom reicht …“
 *   cache-schluckt-abbruch  put mit `catch (_: Throwable)` → rot in QuelltextRatscheTest
 */
class AbbruchDurchTest {

    @get:Rule val ordner = TemporaryFolder()

    /** Scheitert beim Schreiben und Lesen wie ein geändertes Modell. */
    private object Kaputt : KSerializer<String> {
        override val descriptor: SerialDescriptor = String.serializer().descriptor
        override fun serialize(encoder: Encoder, value: String) = error("kaputt")
        override fun deserialize(decoder: Decoder): String = error("kaputt")
    }

    private fun cache() = ResponseCache(bereichQuelle = { "konto" }) { ordner.root }

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

    @Test
    fun `ein Schreibfehler im Cache bleibt still, ein Lesefehler wird null`() = runTest {
        val c = cache()
        c.put("konto", "sets", Kaputt, "x")
        c.put("konto", "sets", String.serializer(), "Falcon")
        assertEquals("Falcon", c.getMitStand("konto", "sets", String.serializer())?.first)
        assertEquals(null, c.getMitStand("konto", "sets", Kaputt))
        assertEquals(null, c.getMitStand("konto", "sets", Int.serializer()))
    }

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
