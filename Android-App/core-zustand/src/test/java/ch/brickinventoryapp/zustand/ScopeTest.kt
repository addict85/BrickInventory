package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.zustand.ui.Scope
import ch.brickinventoryapp.zustand.ui.FilterStore
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.TestApi

/**
 * Der Blickfeld-Dienst — Kontofilter, Lagerfilter, Haushaltskonten — ausgeführt
 * gegen eine Ablage im Speicher und einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen Blickfeld.kt):
 *   A  in loadMembers() den Rückfall auf ALL entfernt → rot „ein Filter auf
 *      ein Konto, das nicht mehr dazugehört, fällt auf alle zurück“
 *   B  in loadFilter() das Übernehmen der Lagerfilter entfernt → rot „die
 *      gemerkten Filter kommen aus der Ablage“
 *   C  in loginBegins() `ablage.everythingForgotten()` entfernt → rot „eine
 *      Anmeldung beginnt mit allen Konten“
 */
class ScopeTest {

    /** Ablage im Speicher, die mitschreibt. */
    private class Ablage : FilterStore {
        val konten = mutableMapOf<String, String>()
        val lager = mutableMapOf<String, String>()
        override suspend fun konto(view: ScopeFilter.View) = konten[view.key] ?: ScopeFilter.ALL
        override suspend fun lager(view: ScopeFilter.View) = lager[view.key] ?: ""
        override suspend fun setAccount(view: ScopeFilter.View, wert: String) { konten[view.key] = wert }
        override suspend fun setzeLager(view: ScopeFilter.View, wert: String) { lager[view.key] = wert }
        override suspend fun everythingForgotten() { konten.clear(); lager.clear() }
    }

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var ablage: Ablage
    private lateinit var blick: Scope

    @Before
    fun auf() {
        server = MockWebServer().apply { start() }
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-blick-${System.nanoTime()}").apply { mkdirs() }
        val api = TestApi.fuer(server)
        ablage = Ablage()
        blick = Scope(ablage, testHouseholdRepository(api), testPartsRepository(api))
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test(timeout = 5000)
    fun `die gemerkten Filter kommen aus der Ablage`() = runTest {
        ablage.konten["gallery"] = "own"
        ablage.lager["parts"] = "Kiste 3"
        blick.loadFilter()
        assertEquals(Kontoauswahl.Eigene, blick.accountFor(ScopeFilter.View.GALLERY))
        assertNull("„alle“ reist nicht als Parameter mit", blick.accountFor(ScopeFilter.View.PARTS))
        assertEquals("Kiste 3", blick.storageFor(ScopeFilter.View.PARTS))
    }

    @Test
    fun `ein gesetzter Filter wird gemerkt und gilt sofort`() = runTest {
        blick.setAccount(ScopeFilter.View.FINANCE, "7")
        assertEquals("7", ablage.konten["finance"])
        assertEquals(Kontoauswahl.Konto(7), blick.accountFor(ScopeFilter.View.FINANCE))
    }

    @Test
    fun `ein Filter auf ein Konto, das nicht mehr dazugehoert, faellt auf alle zurueck`() = runTest {
        blick.setAccount(ScopeFilter.View.GALLERY, "9")
        blick.setAccount(ScopeFilter.View.PARTS, "7")
        server.enqueue(TestApi.antwort("""{"success":true,"members":[
            {"id":1,"username":"marco","is_self":true},{"id":7,"username":"kind"}]}"""))
        blick.loadMembers()
        assertEquals(2, blick.konten.value.householdMembers.size)
        assertNull("Konto 9 gibt es nicht mehr", blick.accountFor(ScopeFilter.View.GALLERY))
        assertEquals(Kontoauswahl.Konto(7), blick.accountFor(ScopeFilter.View.PARTS))
    }

    @Test
    fun `eine Anmeldung beginnt mit allen Konten`() = runTest {
        blick.setAccount(ScopeFilter.View.GALLERY, "own")
        blick.setzeLager(ScopeFilter.View.GALLERY, "Regal")
        blick.loginBegins()
        assertTrue(ablage.konten.isEmpty() && ablage.lager.isEmpty())
        assertNull(blick.accountFor(ScopeFilter.View.GALLERY))
        assertNull(blick.storageFor(ScopeFilter.View.GALLERY))
    }
}
