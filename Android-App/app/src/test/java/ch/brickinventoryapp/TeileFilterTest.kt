package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/** Ein Repository gegen einen Testserver; [block] bekommt beides. */
private fun <T> mitServer(block: (PfadServer, ResponseCache) -> T): T {
    val pfade = PfadServer()
    val ordner = java.io.File(System.getProperty("java.io.tmpdir"), "bim-filter-${System.nanoTime()}").apply { mkdirs() }
    try { return block(pfade, ResponseCache { ordner }) } finally { pfade.server.shutdown(); ordner.deleteRecursively() }
}

/**
 * Der Teile-Reiter filtert nach Farbe und Kategorie — wie die Webapp.
 *
 * ── Woher dieser Test kommt (Nachtrag 134) ──────────────────────────────────
 *
 * Gemessen, nicht gelesen: Ein Vergleich der Server-Adressen beider Clients
 * (Retrofit-Annotationen gegen `api(...)` und `fetch(...)` in public/js)
 * meldete 21 Adressen, die NUR die Webapp ruft. Zwei davon sind
 * /v1/parts/colors und /v1/parts/categories — die beiden Filterlisten des
 * Teile-Reiters, jede mit Zaehlwerten daneben.
 *
 * Die App bot dort ausschliesslich die Suche. Bei tausenden Teilen ist die
 * Farbe der naheliegendste Weg, ueberhaupt etwas wiederzufinden.
 *
 * ── Der eigentlich bemerkenswerte Teil ──────────────────────────────────────
 *
 * Die Leitung lag bereits: `BrickApiService.getParts` deklariert
 * `@Query("color")` und `@Query("category")` seit jeher, und
 * `TeileRepository.getParts` reicht beide durch. GESETZT hat sie nie jemand.
 *
 * Eine halbfertige Funktion faellt in keiner der bestehenden Pruefungen auf:
 * Ein Parameter mit Vorgabewert ist kein toter Code, und ein Zustandsfeld gab
 * es dafuer nicht. Deshalb dieser Test — er haelt fest, dass die beiden Werte
 * auch WIRKLICH mitgeschickt werden.
 *
 * Ausgeführt gegen einen Testserver: Was das Repository wirklich abruft. Dass
 * die Filter aus dem Zustand mitreisen und die Scrollstelle vergessen, prüft
 * TeileTest.
 *
 * Gegenprobe (29.10.2026, gemessen): in TeileRepository.getPartsFilterColors
 * `accounts` nicht weitergereicht → rot „die App ruft beide Filterlisten …“.
 */
class TeileFilterTest {

    @Test
    fun `die App ruft beide Filterlisten mit dem Blickfeld`() = mitServer { pfade, cache ->
        // Beide mit `accounts`: Sonst zaehlten sie im Haushalt anders als die
        // Liste darunter — genau der Fehler, den der Server dabei hatte.
        val teile = TeileRepository(TestApi.fuer(pfade.server), cache)
        runBlocking {
            teile.getPartsFilterColors(accounts = "own")
            teile.getPartsCategories(accounts = "own")
        }
        assertEquals(listOf("GET /api/v1/parts/colors?accounts=own", "GET /api/v1/parts/categories?accounts=own"),
            pfade.anfragen.toList())
    }
}

/**
 * Der CSV-Import laesst sich abbrechen — wie in der Webapp.
 *
 * ── Woher dieser Test kommt (Nachtrag 134) ──────────────────────────────────
 *
 * Aus derselben Messung wie die Filter darueber: /v1/sets/import/csv/cancel
 * war eine von 21 Server-Adressen, die nur die Webapp ruft. Die App zeigte
 * denselben Fortschrittsbalken (CsvImportBanner) und bot keinen Weg heraus —
 * ein versehentlich gestarteter Import ueber hunderte Sets holt zu jedem die
 * Stammdaten und musste ausgesessen werden.
 */
class CsvAbbruchTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App ruft die Abbruch-Adresse`() = mitServer { pfade, cache ->
        runBlocking { SetsRepository(TestApi.fuer(pfade.server), cache).cancelCsvImport() }
        assertEquals(listOf("POST /api/v1/sets/import/csv/cancel"), pfade.anfragen.toList())
    }

    @Test
    fun `der Abbruch meldet seinen Fehler`() {
        // Dieselbe Regel wie fuer jede andere aendernde Handlung
        // (AktionMeldetFehlerTest): Scheitert sie lautlos, tippt der Nutzer
        // weiter und wundert sich, dass der Balken laeuft.
        val s = code(read("ui/AppViewModel.kt"))
        val ab = s.indexOf("fun cancelCsvImport(")
        assert(ab > 0) { "cancelCsvImport fehlt" }
        val rumpf = s.substring(ab, minOf(ab + 500, s.length))
        // meldungFuerSnackbar statt meldung: Seit Marcos Befund („Sitzung
        // abgelaufen" beim Anmelden) geht JEDE Snackbar ueber diesen Trichter.
        // Er reicht den Satz durch — ausser bei einem 401, den die
        // Sitzungsschicht schon behandelt hat. Die REGEL hier ist unveraendert:
        // Der Abbruch darf nicht lautlos scheitern.
        assert(rumpf.contains("_snackbar.value = texte.meldungFuerSnackbar(r)")) {
            "Der Abbruch scheitert lautlos"
        }
    }

    @Test
    fun `der Knopf steht in der Kopfzeile, nicht im aufgeklappten Teil`() {
        // Wer abbrechen will, soll nicht erst herausfinden muessen, dass der
        // Balken sich aufklappen laesst. In der Webapp steht der Knopf
        // dauerhaft da (btn-cancel-import).
        val s = code(read("ui/screens/CsvImportBanner.kt"))
        val knopf = s.indexOf("R.string.csv_cancel")
        val aufgeklappt = s.indexOf("if (expanded) {")
        assert(knopf > 0) { "Der Abbrechen-Knopf fehlt" }
        assert(aufgeklappt > 0) { "Der aufklappbare Teil fehlt — Test veraltet?" }
        assert(knopf < aufgeklappt) {
            "Der Abbrechen-Knopf steht im aufgeklappten Teil und ist damit versteckt"
        }
    }
}
