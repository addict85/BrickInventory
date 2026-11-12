package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.testing.PfadServer
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Zwei Lesemodelle, klar getrennt: Die Ablage (Room) hält die ungefilterte Sammlung
 * und beantwortet Suche und Filter selbst; die Kontosicht fragt den Server, wo er
 * Mengen je Konto aufteilt — und landet nie in der Ablage.
 *
 * Gegenproben (kotlinc gegen Kontosicht.kt, Abruf.kt und SetsRepositoryImpl.kt):
 *   A  in Kontosicht.galerie `a.suche` durch `null` ersetzt → rot „jeder Filter der
 *      Kontosicht steht in der Anfrage“
 *   B  in Serversicht.aktualisiere zusätzlich in die Ablage übernommen → rot „die
 *      Kontosicht landet nicht in der Ablage“
 *   C  in alleSeiten die Zeilen nicht nach Schlüssel zusammengefasst (Liste statt Map)
 *      → rot „die Kontosicht holt alle Seiten und keine Zeile doppelt“
 *   D  in Serversicht.beobachte das Sammeln von `ablage.veraendert` entfernt → rot
 *      „ein Schreibvorgang zeigt sich auch in der Kontosicht“
 *   E  in Serversicht.beobachte den Vergleich des Bereichs entfernt → rot „eine
 *      Antwort für ein anderes Konto zeigt die Kontosicht nicht“
 *   F  in aktualisiereSeitenweise auch bei einem Fehler übernommen → rot „die volle
 *      Sicht steht in der Ablage und trägt bei Netzausfall“
 */
class KontosichtTest {

    private var bereich: String? = "a"
    private val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { bereich })
    private val pfade = PfadServer(
        "/api/v1/sets" to """{"success":true,"total":2,"sets":[{"set_number":"10-1","name":"Haus"},{"set_number":"11-1","name":"Burg"}]}""",
    )
    private val api = pfade.imTakt()
    private val sicht = Kontosicht(api, api, api, ablage, Wiederholung.EINMAL)
    private val sets = SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @After
    fun zu() = pfade.server.shutdown()

    private fun abfrage(konten: Kontoauswahl = Kontoauswahl.Konto(7)) =
        Kontosicht.SetsAbfrage(konten, "falcon", "Star Wars", Setsortierung.PREIS_ABSTEIGEND, "Regal 2")

    @Test
    fun `jeder Filter der Kontosicht steht in der Anfrage`() = runBlocking {
        sicht.galerie.aktualisiere(abfrage())
        val pfad = pfade.anfragenAn("GET /api/v1/sets?").single()
        for (teil in listOf("accounts=7", "search=falcon", "theme=Star%20Wars", "sort=price_desc", "storage=Regal%202")) {
            assertTrue("$teil fehlt: $pfad", teil in pfad)
        }
        assertEquals(listOf("10-1", "11-1"), sicht.galerie.beobachte(abfrage()).first().liste.map { it.setNumber })
    }

    @Test
    fun `die Kontosicht landet nicht in der Ablage`() = runBlocking {
        sicht.galerie.aktualisiere(abfrage())
        val abgelegt = sets.beobachteSets().first()
        assertNull("nie geladen", abgelegt.stand)
        assertTrue(abgelegt.liste.isEmpty())
    }

    @Test
    fun `die Kontosicht holt alle Seiten und keine Zeile doppelt`() = runBlocking {
        pfade.vorrang = { _, pfad ->
            if ("page=2" in pfad) 200 to """{"success":true,"total":3,"sets":[{"set_number":"11-1"},{"set_number":"12-1"}]}"""
            else 200 to """{"success":true,"total":3,"sets":[{"set_number":"10-1"},{"set_number":"11-1"}]}"""
        }
        sicht.galerie.aktualisiere(abfrage())
        assertEquals(listOf("10-1", "11-1", "12-1"), sicht.galerie.beobachte(abfrage()).first().liste.map { it.setNumber })
        assertEquals(2, pfade.anfragenAn("GET /api/v1/sets?").size)
    }

    @Test
    fun `ein Schreibvorgang zeigt sich auch in der Kontosicht`() = runBlocking {
        sicht.galerie.aktualisiere(abfrage())
        val vorher = pfade.anfragenAn("GET /api/v1/sets?").size
        val gesehen = CompletableDeferred<Unit>()
        val beobachter = launch { sicht.galerie.beobachte(abfrage()).collect { gesehen.complete(Unit) } }
        // Erst wenn die Sicht beobachtet, zählt die Änderung: veraendert() lässt den ersten Stand weg.
        gesehen.await()
        repeat(50) { yield() }
        // Was ein Repository anwendet, ändert die Ablage — die Kontosicht fragt neu.
        ablage.wendeAn(Bearbeitung.SetErfassen(AddSetRequest("12-1")))
        // Die neue Anfrage läuft über den Testserver, also auf einem fremden Faden.
        withTimeoutOrNull(5_000) { while (pfade.anfragenAn("GET /api/v1/sets?").size <= vorher) delay(10) }
        beobachter.cancel()
        assertEquals("neu gefragt", vorher + 1, pfade.anfragenAn("GET /api/v1/sets?").size)
    }

    @Test
    fun `eine Antwort fuer ein anderes Konto zeigt die Kontosicht nicht`() = runBlocking {
        sicht.galerie.aktualisiere(abfrage())
        bereich = "b"
        val l = sicht.galerie.beobachte(abfrage()).first()
        assertNull(l.stand)
        assertTrue(l.liste.isEmpty())
    }

    @Test
    fun `die volle Sicht steht in der Ablage und traegt bei Netzausfall`() = runBlocking {
        assertTrue(sets.aktualisiereSets() is Ergebnis.Success)
        val abruf = pfade.anfragenAn("GET /api/v1/sets?").single()
        assertTrue("ungefiltert: $abruf", "search=" !in abruf && "accounts=" !in abruf)
        pfade.codes["/api/v1/sets"] = 500
        assertTrue(sets.aktualisiereSets() is Ergebnis.Error)
        val abgelegt = sets.beobachteSets(thema = null).first()
        assertTrue("mit Stand", abgelegt.stand != null)
        assertEquals("ein Fehler leert die Ablage nicht", listOf("10-1", "11-1"), abgelegt.liste.map { it.setNumber })
        assertEquals("die Ablage beantwortet die Suche selbst", listOf("11-1"),
            sets.beobachteSets(suche = "burg").first().liste.map { it.setNumber })
    }
}
