package ch.brickinventoryapp

import ch.brickinventoryapp.ui.CsvFolge
import ch.brickinventoryapp.ui.csvFolge
import ch.brickinventoryapp.ui.importLaeuft
import org.junit.Test

/**
 * Ein abgeschlossener CSV-Import lädt die Daten GENAU EINMAL neu.
 *
 * ── Marcos Befund (Nachtrag 110) ────────────────────────────────────────────
 * „In der Galerie springt die Liste beim Scrollen zurück — immer auf dieselbe
 * Zeile." Sein Protokoll zeigte es unmissverständlich:
 *
 *     Seite 2: 60 empfangen, Liste  60 -> 120
 *     Seite 3: 60 empfangen, Liste 120 -> 180
 *     Seite 4: 60 empfangen, Liste 180 -> 240
 *     Seite 2: 60 empfangen, Liste  60 -> 120     ← zurück auf Anfang
 *
 * Alle fünf bis zehn Sekunden fiel die Liste auf 60 Einträge zurück; das Raster
 * landete auf der letzten noch vorhandenen Zeile — immer derselben.
 *
 * Ursache: Der SSE-Strom meldet den Importstatus fortlaufend, auch lange
 * nachdem der Import fertig ist. Die Bedingung fragte nur „läuft gerade nicht
 * und ist kein Fehler" — das trifft auf JEDE Meldung eines abgeschlossenen
 * Imports zu. Also lief `finishCsvImport()` alle paar Sekunden erneut und
 * ersetzte mit `loadSets()` die ganze Liste durch Seite 1. Der Wächter
 * `csvFinishing` half nicht: Er wird nach fünf Sekunden wieder freigegeben —
 * genau im Takt der Meldungen.
 *
 * Die Regel: Ein Abschluss ist ein ÜBERGANG, kein Zustand. Nachgeladen wird
 * nur, wenn vorher tatsächlich ein Import lief. Dieselbe Verwechslung wie beim
 * Takt der Anleitungs-Warteschlange (Manager-Nachtrag 142) und beim Bild-Job
 * (217): Eine Handlung wurde an einen Zustand gehängt statt an das Ereignis,
 * das sie auslösen soll.
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
 * Übergangstabelle durch. Was `handleCsvStatus()` weiterhin nur der Quelltext
 * zeigen kann, ist die REIHENFOLGE (die Entscheidung muss vor dem
 * Überschreiben des Zustands fallen); genau das prüft der letzte Test hier,
 * und nur das.
 *
 * ── Gegenprobe (ausgeführt, Lauf 33632359947) ───────────────────────────────
 * Im Gegenprobe-Commit gab `csvFolge()` im Fall „fertig" immer NACHLADEN
 * zurück, also ohne `warVorherAktiv` — genau der Fehler aus Nachtrag 110.
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
        assert(csvFolge(warVorherAktiv = true, status = "done") == CsvFolge.NACHLADEN) {
            "Ein Import, der gerade fertig geworden ist, muss die Daten neu laden — " +
                "sonst bleibt nach dem Import die alte Liste stehen."
        }
    }

    @Test
    fun `ein seit Stunden fertiger Import laedt nicht nach`() {
        // Genau Marcos Rücksprung: Der Strom meldet „done" weiter, ohne dass
        // vorher noch etwas lief.
        for (status in listOf("done", "cancelled", "finished")) {
            assert(csvFolge(warVorherAktiv = false, status = status) == CsvFolge.NICHTS) {
                "Statusmeldung \"$status\" ohne vorherigen Lauf löst ein Nachladen aus. " +
                    "Der SSE-Strom schickt sie alle paar Sekunden — die Galerie fällt " +
                    "damit dauernd auf Seite 1 zurück."
            }
        }
    }

    @Test
    fun `ein laufender Import startet den Dienst genau einmal`() {
        for (status in listOf("running", "pending")) {
            assert(csvFolge(warVorherAktiv = false, status = status) == CsvFolge.DIENST_STARTEN) {
                "Beim Anlaufen (\"$status\") muss der Vordergrunddienst starten"
            }
            assert(csvFolge(warVorherAktiv = true, status = status) == CsvFolge.NICHTS) {
                "Jede Fortschrittszeile startet den Dienst erneut — dasselbe Muster " +
                    "wie der Rücksprung, nur an anderer Stelle."
            }
        }
    }

    @Test
    fun `pending zaehlt als laufend`() {
        // Sonst wirkt die App zwischen Auftragsannahme und erster Zeile
        // eingefroren: kein Banner, kein Dienst.
        assert(importLaeuft("pending")) { "pending gilt nicht mehr als laufend" }
        assert(importLaeuft("running")) { "running gilt nicht mehr als laufend" }
        assert(!importLaeuft("done")) { "done gilt als laufend" }
        assert(!importLaeuft(null)) { "eine Meldung ohne Zustand gilt als laufend" }
    }

    @Test
    fun `ein Fehler laedt nicht nach`() {
        // Ein gescheiterter Import hat nichts geliefert, was sich nachzuladen
        // lohnte — und würde die Liste trotzdem zurücksetzen.
        assert(csvFolge(warVorherAktiv = true, status = "error") == CsvFolge.FEHLER_AUFRAEUMEN)
        assert(csvFolge(warVorherAktiv = false, status = "error") == CsvFolge.FEHLER_AUFRAEUMEN)
    }

    @Test
    fun `eine Meldung ohne Zustand loest nichts aus`() {
        // status == null heisst nicht „fertig", sondern „unvollständige Meldung".
        assert(csvFolge(warVorherAktiv = true, status = null) == CsvFolge.NICHTS)
        assert(csvFolge(warVorherAktiv = false, status = null) == CsvFolge.NICHTS)
    }

    @Test
    fun `die Entscheidung faellt VOR dem Ueberschreiben des Zustands`() {
        // Das Einzige, was hier Quelltext bleiben muss: csvFolge() ist nur so
        // gut wie das, was hineingereicht wird. Wird _csvImportState zuerst
        // überschrieben, ist `warVorherAktiv` immer der NEUE Wert — die ganze
        // Übergangstabelle oben liefe dann ins Leere.
        val src = Quellen.ohneKommentare(Quellen.lies("ui/MainViewModel.kt"))
        val start = src.indexOf("suspend fun handleCsvStatus(")
        assert(start >= 0) { "handleCsvStatus() nicht gefunden" }
        val fn = src.substring(start, src.indexOf("\n    }", start))

        val entschieden = fn.indexOf("csvFolge(")
        val geschrieben = fn.indexOf("_csvImportState.value = CsvImportUiState(")
        assert(entschieden >= 0) { "handleCsvStatus() benutzt csvFolge() nicht mehr" }
        assert(geschrieben >= 0) { "handleCsvStatus() setzt _csvImportState nicht mehr" }
        assert(entschieden < geschrieben) {
            "csvFolge() wird erst nach dem Überschreiben von _csvImportState " +
                "aufgerufen und bekommt damit immer den neuen Zustand als \"vorher\"."
        }
    }

    @Test
    fun `finishCsvImport laedt die Daten neu`() {
        // Der Sinn der Sache — sonst bliebe nach einem Import die alte Liste stehen.
        val src = Quellen.ohneKommentare(Quellen.lies("ui/MainViewModel.kt"))
        val i = src.indexOf("private suspend fun finishCsvImport()")
        assert(i >= 0) { "finishCsvImport() nicht gefunden" }
        val fn = src.substring(i, src.indexOf("\n    }", i))
        assert(fn.contains("loadSets()")) { "Nach einem Import wird nicht mehr nachgeladen" }
    }
}
