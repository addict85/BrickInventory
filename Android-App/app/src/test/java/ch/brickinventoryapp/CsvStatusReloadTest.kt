package ch.brickinventoryapp

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
 * ── Ursache ─────────────────────────────────────────────────────────────────
 * Der SSE-Strom meldet den Importstatus fortlaufend, auch lange nachdem der
 * Import fertig ist. Die Bedingung fragte nur „läuft gerade nicht und ist kein
 * Fehler" — das trifft auf JEDE Meldung eines abgeschlossenen Imports zu. Also
 * lief `finishCsvImport()` alle paar Sekunden erneut und ersetzte mit
 * `loadSets()` die ganze Liste durch Seite 1.
 *
 * Der Wächter `csvFinishing` half nicht: Er wird nach fünf Sekunden wieder
 * freigegeben — genau im Takt der Meldungen.
 *
 * ── Die Regel ───────────────────────────────────────────────────────────────
 * Ein Abschluss ist ein ÜBERGANG, kein Zustand. Nachgeladen wird nur, wenn
 * vorher tatsächlich ein Import lief.
 *
 * Dieselbe Verwechslung wie beim Takt der Anleitungs-Warteschlange
 * (Manager-Nachtrag 142) und beim Bild-Job (217): Eine Handlung wurde an einen
 * Zustand gehängt statt an das Ereignis, das sie auslösen soll.
 */
class CsvStatusReloadTest {

    private fun quelle(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/ui/MainViewModel.kt").readText()

    /** Der Rumpf von handleCsvStatus(), ohne Kommentare. */
    private fun handleCsvStatus(): String {
        val src = quelle().lines()
            .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }
        val start = src.indexOf("suspend fun handleCsvStatus(")
        assert(start >= 0) { "handleCsvStatus() nicht gefunden" }
        val ende = src.indexOf("\n    }", start)
        return src.substring(start, if (ende > start) ende else src.length)
    }

    @Test
    fun `nachgeladen wird nur beim Uebergang von laufend auf fertig`() {
        val fn = handleCsvStatus()

        assert(fn.contains("val warVorherAktiv = _csvImportState.value.running")) {
            "Der vorherige Zustand wird nicht mehr festgehalten — dann ist ein " +
                "Abschluss nicht von einem seit Stunden abgeschlossenen Import zu " +
                "unterscheiden."
        }
        assert(Regex("""if \(!running && warVorherAktiv""").containsMatchIn(fn)) {
            "finishCsvImport() läuft wieder bei JEDER Statusmeldung. Das ersetzt " +
                "alle paar Sekunden die ganze Galerie durch Seite 1 — genau Marcos " +
                "Rücksprung."
        }
    }

    @Test
    fun `der vorherige Zustand wird VOR dem Ueberschreiben gelesen`() {
        // _csvImportState wird in derselben Funktion neu gesetzt. Wird der alte
        // Wert danach gelesen, ist er bereits der neue — die Prüfung oben wäre
        // wirkungslos.
        val fn = handleCsvStatus()
        val gelesen = fn.indexOf("val warVorherAktiv")
        val geschrieben = fn.indexOf("_csvImportState.value = CsvImportUiState(")
        assert(gelesen in 0 until geschrieben) {
            "warVorherAktiv wird erst nach dem Überschreiben von _csvImportState " +
                "gelesen und ist damit immer der NEUE Wert."
        }
    }

    @Test
    fun `finishCsvImport laedt die Daten neu`() {
        // Der Sinn der Sache — sonst bliebe nach einem Import die alte Liste stehen.
        val src = quelle()
        val i = src.indexOf("private suspend fun finishCsvImport()")
        assert(i >= 0) { "finishCsvImport() nicht gefunden" }
        val fn = src.substring(i, src.indexOf("\n    }", i))
        assert(fn.contains("loadSets()")) { "Nach einem Import wird nicht mehr nachgeladen" }
    }
}
