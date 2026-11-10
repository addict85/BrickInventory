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
 */
class CsvAbbruchTest {

    @Test
    fun `die App ruft die Abbruch-Adresse`() = mitServer { pfade, cache ->
        runBlocking { SetsRepository(TestApi.fuer(pfade.server), cache).cancelCsvImport() }
        assertEquals(listOf("POST /api/v1/sets/import/csv/cancel"), pfade.anfragen.toList())
    }
}
