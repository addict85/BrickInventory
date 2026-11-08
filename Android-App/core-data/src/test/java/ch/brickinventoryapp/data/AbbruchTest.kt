package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.fangeAusserAbbruch
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
 * `catch (abbruch: CancellationException) { throw abbruch }` entfernt → rot
 * „ein abgebrochener Auftrag läuft nicht weiter“ und „das Abbrechen geht durch“.
 */
class AbbruchTest {

    @Test
    fun `ein gewoehnlicher Fehler wird zum Ergebnis`() {
        val r = fangeAusserAbbruch { error("kaputt") }
        assertEquals("kaputt", r.exceptionOrNull()?.message)
        assertEquals(3, fangeAusserAbbruch { 3 }.getOrNull())
    }

    @Test
    fun `das Abbrechen geht durch`() {
        var durch = false
        try {
            fangeAusserAbbruch { throw CancellationException("weg") }
        } catch (_: CancellationException) {
            durch = true
        }
        assertTrue("CancellationException wurde als Fehler verschluckt", durch)
    }

    @Test
    fun `ein Error wird nicht gefangen`() {
        var durch = false
        try {
            fangeAusserAbbruch { throw AssertionError("hart") }
        } catch (_: AssertionError) {
            durch = true
        }
        assertTrue("Ein Error darf nicht im Ergebnis verschwinden", durch)
    }

    @Test
    fun `ein abgebrochener Auftrag laeuft nicht weiter`() = runTest {
        val schritte = mutableListOf<String>()
        val auftrag = launch(start = CoroutineStart.UNDISPATCHED) {
            fangeAusserAbbruch { delay(10_000) }.onFailure { schritte += "Fehlerzweig" }
            schritte += "danach"
        }
        auftrag.cancel()
        auftrag.join()
        assertEquals(emptyList<String>(), schritte)
        assertTrue(auftrag.isCancelled)
    }
}
