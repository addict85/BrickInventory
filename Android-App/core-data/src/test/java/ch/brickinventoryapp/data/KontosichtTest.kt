package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
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
 * Two read models, clearly separated: the store (Room) holds the unfiltered collection
 * and answers search and filter itself; the account view asks the server, where it
 * splits quantities per account — and never ends up in the store.
 *
 * Counter-checks (kotlinc against Kontosicht.kt, Abruf.kt and SetsRepositoryImpl.kt):
 *   A  in Kontosicht.galerie `a.suche` replaced by `null` → red “every filter of the
 *      account view is in the request”
 *   B  in Serversicht.aktualisiere additionally taken into the store → red “the
 *      account view does not end up in the store”
 *   C  in allPages the rows not merged by key (list instead of map)
 *      → red “the account view fetches all pages and no row twice”
 *   D  in Serversicht.beobachte the collecting of `ablage.altered` removed → red
 *      “a write shows up in the account view too”
 *   E  in Serversicht.beobachte the comparison of the area removed → red “the
 *      account view does not show a response for a different account”
 *   F  in refreshPaged applied even on an error → red “the full
 *      view is in the store and carries through a network outage”
 */
class KontosichtTest {

    private var bereich: String? = "a"
    private val ablage = Offlineablage(StorageInventory(), StorageExit(), { bereich })
    private val paths = PfadServer(
        "/api/v1/sets" to """{"success":true,"total":2,"sets":[{"set_number":"10-1","name":"Haus"},{"set_number":"11-1","name":"Burg"}]}""",
    )
    private val api = paths.imTakt()
    private val view = Kontosicht(api, api, api, ablage, Wiederholung.EINMAL)
    private val sets = SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @After
    fun zu() = paths.server.shutdown()

    private fun abfrage(konten: Kontoauswahl = Kontoauswahl.Konto(7)) =
        Kontosicht.SetsQuery(konten, "falcon", "Star Wars", Setsortierung.PREIS_ABSTEIGEND, "Regal 2")

    @Test
    fun `every filter of the account view is in the request`() = runBlocking {
        view.galerie.refresh(abfrage())
        val pfad = paths.requestsAn("GET /api/v1/sets?").single()
        for (teil in listOf("accounts=7", "search=falcon", "theme=Star%20Wars", "sort=price_desc", "storage=Regal%202")) {
            assertTrue("$teil fehlt: $pfad", teil in pfad)
        }
        assertEquals(listOf("10-1", "11-1"), view.galerie.observe(abfrage()).first().liste.map { it.setNumber })
    }

    @Test
    fun `the account view does not end up in the store`() = runBlocking {
        view.galerie.refresh(abfrage())
        val abgelegt = sets.observeSets().first()
        assertNull("nie geladen", abgelegt.stand)
        assertTrue(abgelegt.liste.isEmpty())
    }

    @Test
    fun `the account view fetches all pages and no row twice`() = runBlocking {
        paths.priority = { _, pfad ->
            if ("page=2" in pfad) 200 to """{"success":true,"total":3,"sets":[{"set_number":"11-1"},{"set_number":"12-1"}]}"""
            else 200 to """{"success":true,"total":3,"sets":[{"set_number":"10-1"},{"set_number":"11-1"}]}"""
        }
        view.galerie.refresh(abfrage())
        assertEquals(listOf("10-1", "11-1", "12-1"), view.galerie.observe(abfrage()).first().liste.map { it.setNumber })
        assertEquals(2, paths.requestsAn("GET /api/v1/sets?").size)
    }

    @Test
    fun `a write shows up in the account view too`() = runBlocking {
        view.galerie.refresh(abfrage())
        val vorher = paths.requestsAn("GET /api/v1/sets?").size
        val gesehen = CompletableDeferred<Unit>()
        val observer = launch { view.galerie.observe(abfrage()).collect { gesehen.complete(Unit) } }
        // Only once the view observes does the change count: veraendert() leaves out the first state.
        gesehen.await()
        repeat(50) { yield() }
        // What a repository applies changes the store — the account view asks anew.
        ablage.applyAn(Editing.SetErfassen(Erfassungswunsch(setNumber = "12-1")))
        // The new request runs via the test server, thus on a foreign thread.
        withTimeoutOrNull(5_000) { while (paths.requestsAn("GET /api/v1/sets?").size <= vorher) delay(10) }
        observer.cancel()
        assertEquals("neu gefragt", vorher + 1, paths.requestsAn("GET /api/v1/sets?").size)
    }

    @Test
    fun `the account view does not show a response for a different account`() = runBlocking {
        view.galerie.refresh(abfrage())
        bereich = "b"
        val l = view.galerie.observe(abfrage()).first()
        assertNull(l.stand)
        assertTrue(l.liste.isEmpty())
    }

    @Test
    fun `the full view is in the store and carries through a network outage`() = runBlocking {
        assertTrue(sets.aktualisiereSets() is Ergebnis.Erfolg)
        val abruf = paths.requestsAn("GET /api/v1/sets?").single()
        assertTrue("ungefiltert: $abruf", "search=" !in abruf && "accounts=" !in abruf)
        paths.codes["/api/v1/sets"] = 500
        assertTrue(sets.aktualisiereSets() is Ergebnis.Fehler)
        val abgelegt = sets.observeSets(thema = null).first()
        assertTrue("mit Stand", abgelegt.stand != null)
        assertEquals("ein Fehler leert die Ablage nicht", listOf("10-1", "11-1"), abgelegt.liste.map { it.setNumber })
        assertEquals("die Ablage beantwortet die Suche selbst", listOf("11-1"),
            sets.observeSets(suche = "burg").first().liste.map { it.setNumber })
    }
}
