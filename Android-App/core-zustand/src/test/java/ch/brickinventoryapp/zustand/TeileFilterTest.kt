package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.TestApi

/** Ein Repository gegen einen Testserver; [block] bekommt beides. */
private fun <T> mitServer(block: (PfadServer, ResponseCache) -> T): T {
    val pfade = PfadServer()
    val ordner = File(System.getProperty("java.io.tmpdir"), "bim-filter-${System.nanoTime()}").apply { mkdirs() }
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
 * Gegenprobe: in TeileRepository.getPartsFilterColors
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
 *
 * Dass der Knopf zugeklappt in der Kopfzeile steht, prüft CsvAbbrechenKnopfTest (app).
 */
class CsvAbbruchTest {

    @Test
    fun `die App ruft die Abbruch-Adresse`() = mitServer { pfade, cache ->
        runBlocking { SetsRepository(TestApi.fuer(pfade.server), cache).cancelCsvImport() }
        assertEquals(listOf("POST /api/v1/sets/import/csv/cancel"), pfade.anfragen.toList())
    }
}
