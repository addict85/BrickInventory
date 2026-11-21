package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.domain.Laufstatus
import org.junit.Test

/**
 * A finished CSV import reloads the data EXACTLY ONCE.
 *
 * ── Why this test looks different now ───────────────────────────────────────
 * Until here the check stood as a text search in the source of
 * `MainViewModel.kt`: searched was the string
 * `if (!running && warBeforeActive`. That records the wording, not the
 * behavior. An equivalent rewrite would have broken the test, and —
 * worse — a condition that happens to look the same but is fed a
 * wrong `warBeforeActive` would have stayed green.
 *
 * Since the decision stands as [csvSequence] in its own file, it needs
 * no `Context` — the test executes it and goes through the whole
 * transition table. The order in `handleCsvStatus()` (first
 * decide, then overwrite the state) and the reloading are checked by
 * CsvImportViewModelTest on the executed ViewModel.
 *
 * ── Counter-check ───────────────────────────────
 * In the counter-check commit `csvSequence()` always returned NACHLADEN in the case
 * „finished", i.e. without `warBeforeActive`.
 * Result: `351 tests completed, 1 failed`, namely
 * `an import finished hours ago does not reload` (line 74).
 *
 * Two things are thus settled. First, the check applies. Second — and
 * that was what the whole rework was about — the earlier text search would have stayed silent: it
 * looked in MainViewModel.kt, and there the call of `csvSequence()`
 * stands unchanged and correct. The error lay one file further.
 *
 * Only ONE test turned red, not several: `only the transition reloads` stayed
 * green because the breakage fulfils exactly its expectation. A test that
 * fires on every breakage checks too coarsely — here the table separates cleanly.
 */
class CsvStatusReloadTest {

    @Test
    fun `only the transition reloads`() {
        assert(csvSequence(warBeforeActive = true, status = Laufstatus.FERTIG) == CsvSequence.NACHLADEN) {
            "Ein Import, der gerade fertig geworden ist, muss die Daten neu laden — " +
                "sonst bleibt nach dem Import die alte Liste stehen."
        }
    }

    @Test
    fun `an import finished hours ago does not reload`() {
        // The jump back: the stream keeps reporting „done" without anything
        // having run before.
        for (status in listOf("done", "cancelled", "finished")) {
            assert(csvSequence(warBeforeActive = false, status = Laufstatus.aus(status)) == CsvSequence.NICHTS) {
                "Statusmeldung \"$status\" ohne vorherigen Lauf löst ein Nachladen aus. " +
                    "Der SSE-Strom schickt sie alle paar Sekunden — die Galerie fällt " +
                    "damit dauernd auf Seite 1 zurück."
            }
        }
    }

    @Test
    fun `a running import starts the service exactly once`() {
        for (status in listOf("running", "pending")) {
            assert(csvSequence(warBeforeActive = false, status = Laufstatus.aus(status)) == CsvSequence.DIENST_STARTEN) {
                "Beim Anlaufen (\"$status\") muss der Vordergrunddienst starten"
            }
            assert(csvSequence(warBeforeActive = true, status = Laufstatus.aus(status)) == CsvSequence.NICHTS) {
                "Jede Fortschrittszeile startet den Dienst erneut — dasselbe Muster " +
                    "wie der Rücksprung, nur an anderer Stelle."
            }
        }
    }

    @Test
    fun `pending counts as running`() {
        // Otherwise the app seems frozen between job acceptance and the first line:
        // no banner, no service.
        assert(importRunning(Laufstatus.WARTET)) { "pending gilt nicht mehr als laufend" }
        assert(importRunning(Laufstatus.LAEUFT)) { "running gilt nicht mehr als laufend" }
        assert(!importRunning(Laufstatus.FERTIG)) { "done gilt als laufend" }
        assert(!importRunning(null)) { "eine Meldung ohne Zustand gilt als laufend" }
    }

    @Test
    fun `an error does not reload`() {
        // A failed import has delivered nothing worth reloading
        // — and would reset the list anyway.
        assert(csvSequence(warBeforeActive = true, status = Laufstatus.FEHLER) == CsvSequence.FEHLER_AUFRAEUMEN)
        assert(csvSequence(warBeforeActive = false, status = Laufstatus.FEHLER) == CsvSequence.FEHLER_AUFRAEUMEN)
    }

    @Test
    fun `a message without state triggers nothing`() {
        // status == null does not mean „finished" but „incomplete message".
        assert(csvSequence(warBeforeActive = true, status = null) == CsvSequence.NICHTS)
        assert(csvSequence(warBeforeActive = false, status = null) == CsvSequence.NICHTS)
    }
}
