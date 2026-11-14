package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.repository.TeileRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.SetDateienRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.TestApi

/** Ein Testserver für [block], danach heruntergefahren. */
private fun <T> mitServer(block: (PfadServer) -> T): T {
    val pfade = PfadServer()
    try { return block(pfade) } finally { pfade.server.shutdown() }
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
    fun `die App ruft beide Filterlisten mit dem Blickfeld`() = mitServer { pfade ->
        // Beide mit `accounts`: Sonst zaehlten sie im Haushalt anders als die
        // Liste darunter — genau der Fehler, den der Server dabei hatte.
        val teile = TeileRepository(TestApi.fuer(pfade.server))
        runBlocking {
            teile.getPartsFilterColors(konten = Kontoauswahl.Eigene)
            teile.getPartsCategories(konten = Kontoauswahl.Eigene)
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
    fun `die App ruft die Abbruch-Adresse`() = mitServer { pfade ->
        runBlocking { SetDateienRepository(TestApi.fuer(pfade.server)).cancelCsvImport() }
        assertEquals(listOf("POST /api/v1/sets/import/csv/cancel"), pfade.anfragen.toList())
    }
}
