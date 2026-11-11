package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.fach.Laufstatus
import org.junit.Test

/**
 * Ein abgeschlossener CSV-Import lädt die Daten GENAU EINMAL neu.
 *
 * ── Warum dieser Test jetzt anders aussieht ─────────────────────────────────
 * Bis hierher stand die Prüfung als Textsuche im Quelltext von
 * `MainViewModel.kt`: gesucht wurde die Zeichenfolge
 * `if (!running && warVorherAktiv`. Das hält die Formulierung fest, nicht das
 * Verhalten. Eine gleichwertige Umschreibung hätte den Test gebrochen, und —
 * schlimmer — eine Bedingung, die zufällig genauso aussieht, aber mit einem
 * falschen `warVorherAktiv` gefüttert wird, wäre grün geblieben.
 *
 * Seit die Entscheidung als [csvFolge] in einer eigenen Datei steht, braucht
 * sie keinen `Context` — der Test führt sie aus und geht die ganze
 * Übergangstabelle durch. Die Reihenfolge in `handleCsvStatus()` (erst
 * entscheiden, dann den Zustand überschreiben) und das Nachladen prüft
 * CsvImportViewModelTest am ausgeführten ViewModel.
 *
 * ── Gegenprobe ───────────────────────────────
 * Im Gegenprobe-Commit gab `csvFolge()` im Fall „fertig" immer NACHLADEN
 * zurück, also ohne `warVorherAktiv`.
 * Ergebnis: `351 tests completed, 1 failed`, und zwar
 * `ein seit Stunden fertiger Import laedt nicht nach` (Zeile 74).
 *
 * Zwei Dinge stehen damit fest. Erstens greift die Prüfung. Zweitens — und
 * darum ging der ganze Umbau — hätte die frühere Textsuche geschwiegen: Sie
 * sah in MainViewModel.kt nach, und dort steht der Aufruf von `csvFolge()`
 * unverändert richtig da. Der Fehler lag eine Datei weiter.
 *
 * Nur EIN Test wurde rot, nicht mehrere: `nur der Uebergang laedt nach` ist
 * grün geblieben, weil der Bruch genau dessen Erwartung erfüllt. Ein Test, der
 * bei jedem Bruch anschlägt, prüft zu grob — hier trennt die Tabelle sauber.
 */
class CsvStatusReloadTest {

    @Test
    fun `nur der Uebergang laedt nach`() {
        assert(csvFolge(warVorherAktiv = true, status = Laufstatus.FERTIG) == CsvFolge.NACHLADEN) {
            "Ein Import, der gerade fertig geworden ist, muss die Daten neu laden — " +
                "sonst bleibt nach dem Import die alte Liste stehen."
        }
    }

    @Test
    fun `ein seit Stunden fertiger Import laedt nicht nach`() {
        // Der Rücksprung: Der Strom meldet „done" weiter, ohne dass
        // vorher noch etwas lief.
        for (status in listOf("done", "cancelled", "finished")) {
            assert(csvFolge(warVorherAktiv = false, status = Laufstatus.aus(status)) == CsvFolge.NICHTS) {
                "Statusmeldung \"$status\" ohne vorherigen Lauf löst ein Nachladen aus. " +
                    "Der SSE-Strom schickt sie alle paar Sekunden — die Galerie fällt " +
                    "damit dauernd auf Seite 1 zurück."
            }
        }
    }

    @Test
    fun `ein laufender Import startet den Dienst genau einmal`() {
        for (status in listOf("running", "pending")) {
            assert(csvFolge(warVorherAktiv = false, status = Laufstatus.aus(status)) == CsvFolge.DIENST_STARTEN) {
                "Beim Anlaufen (\"$status\") muss der Vordergrunddienst starten"
            }
            assert(csvFolge(warVorherAktiv = true, status = Laufstatus.aus(status)) == CsvFolge.NICHTS) {
                "Jede Fortschrittszeile startet den Dienst erneut — dasselbe Muster " +
                    "wie der Rücksprung, nur an anderer Stelle."
            }
        }
    }

    @Test
    fun `pending zaehlt als laufend`() {
        // Sonst wirkt die App zwischen Auftragsannahme und erster Zeile
        // eingefroren: kein Banner, kein Dienst.
        assert(importLaeuft(Laufstatus.WARTET)) { "pending gilt nicht mehr als laufend" }
        assert(importLaeuft(Laufstatus.LAEUFT)) { "running gilt nicht mehr als laufend" }
        assert(!importLaeuft(Laufstatus.FERTIG)) { "done gilt als laufend" }
        assert(!importLaeuft(null)) { "eine Meldung ohne Zustand gilt als laufend" }
    }

    @Test
    fun `ein Fehler laedt nicht nach`() {
        // Ein gescheiterter Import hat nichts geliefert, was sich nachzuladen
        // lohnte — und würde die Liste trotzdem zurücksetzen.
        assert(csvFolge(warVorherAktiv = true, status = Laufstatus.FEHLER) == CsvFolge.FEHLER_AUFRAEUMEN)
        assert(csvFolge(warVorherAktiv = false, status = Laufstatus.FEHLER) == CsvFolge.FEHLER_AUFRAEUMEN)
    }

    @Test
    fun `eine Meldung ohne Zustand loest nichts aus`() {
        // status == null heisst nicht „fertig", sondern „unvollständige Meldung".
        assert(csvFolge(warVorherAktiv = true, status = null) == CsvFolge.NICHTS)
        assert(csvFolge(warVorherAktiv = false, status = null) == CsvFolge.NICHTS)
    }
}
