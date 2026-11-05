package ch.brickinventoryapp

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.CsvImportStatus
import ch.brickinventoryapp.service.folgeStrom
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
 * abgebrochener Aufrufer liefe sonst weiter, als wäre nichts geschehen.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   cache-schluckt-abbruch  `put` wieder mit `catch (_: Throwable)` → rot „put reicht …“
 *   strom-schluckt-abbruch  folgeStrom mit `catch (_: Exception)`   → rot „folgeStrom reicht …“
 */
class AbbruchDurchTest {

    @get:Rule val ordner = TemporaryFolder()

    /** Bricht beim Schreiben und Lesen ab, wie ein `withTimeout` im Inneren. */
    private object Abbrechend : KSerializer<String> {
        override val descriptor: SerialDescriptor = String.serializer().descriptor
        override fun serialize(encoder: Encoder, value: String) = throw CancellationException("weg")
        override fun deserialize(decoder: Decoder): String = throw CancellationException("weg")
    }

    private fun cache() = ResponseCache(bereichQuelle = { "konto" }) { ordner.root }

    private suspend fun brichtAb(block: suspend () -> Unit): Boolean =
        try { block(); false } catch (_: CancellationException) { true }

    @Test
    fun `put reicht das Abbrechen weiter, ein Schreibfehler bleibt still`() = runTest {
        val c = cache()
        assertTrue("put hat das Abbrechen verschluckt", brichtAb { c.put("konto", "sets", Abbrechend, "x") })
        c.put("konto", "sets", String.serializer(), "Falcon")
        assertEquals("Falcon", c.getMitStand("konto", "sets", String.serializer())?.first)
    }

    @Test
    fun `getMitStand reicht das Abbrechen weiter, ein Lesefehler wird null`() = runTest {
        val c = cache()
        c.put("konto", "sets", String.serializer(), "Falcon")
        assertTrue("getMitStand hat das Abbrechen verschluckt", brichtAb { c.getMitStand("konto", "sets", Abbrechend) })
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
