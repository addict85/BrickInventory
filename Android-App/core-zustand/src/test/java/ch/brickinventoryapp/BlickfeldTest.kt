package ch.brickinventoryapp

import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Blickfeld
import ch.brickinventoryapp.ui.FilterAblage
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * Der Blickfeld-Dienst — Kontofilter, Lagerfilter, Haushaltskonten — ausgeführt
 * gegen eine Ablage im Speicher und einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen Blickfeld.kt):
 *   A  in ladeMitglieder() den Rückfall auf ALL entfernt → rot „ein Filter auf
 *      ein Konto, das nicht mehr dazugehört, fällt auf alle zurück“
 *   B  in ladeFilter() das Übernehmen der Lagerfilter entfernt → rot „die
 *      gemerkten Filter kommen aus der Ablage“
 *   C  in anmeldungBeginnt() `ablage.allesVergessen()` entfernt → rot „eine
 *      Anmeldung beginnt mit allen Konten“
 */
class BlickfeldTest {

    /** Ablage im Speicher, die mitschreibt. */
    private class Ablage : FilterAblage {
        val konten = mutableMapOf<String, String>()
        val lager = mutableMapOf<String, String>()
        override suspend fun konto(view: ScopeFilter.View) = konten[view.key] ?: ScopeFilter.ALL
        override suspend fun lager(view: ScopeFilter.View) = lager[view.key] ?: ""
        override suspend fun setzeKonto(view: ScopeFilter.View, wert: String) { konten[view.key] = wert }
        override suspend fun setzeLager(view: ScopeFilter.View, wert: String) { lager[view.key] = wert }
        override suspend fun allesVergessen() { konten.clear(); lager.clear() }
    }

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var ablage: Ablage
    private lateinit var blick: Blickfeld

    @Before
    fun auf() {
        server = MockWebServer().apply { start() }
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-blick-${System.nanoTime()}").apply { mkdirs() }
        val api = TestApi.fuer(server)
        val cache = ResponseCache { cacheDir }
        ablage = Ablage()
        blick = Blickfeld(ablage, HaushaltRepository(api, cache), TeileRepository(api, cache))
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
        blick.ladeFilter()
        assertEquals("own", blick.kontoFuer(ScopeFilter.View.GALLERY))
        assertNull("„alle“ reist nicht als Parameter mit", blick.kontoFuer(ScopeFilter.View.PARTS))
        assertEquals("Kiste 3", blick.lagerFuer(ScopeFilter.View.PARTS))
    }

    @Test
    fun `ein gesetzter Filter wird gemerkt und gilt sofort`() = runTest {
        blick.setzeKonto(ScopeFilter.View.FINANCE, "7")
        assertEquals("7", ablage.konten["finance"])
        assertEquals("7", blick.kontoFuer(ScopeFilter.View.FINANCE))
    }

    @Test
    fun `ein Filter auf ein Konto, das nicht mehr dazugehoert, faellt auf alle zurueck`() = runTest {
        blick.setzeKonto(ScopeFilter.View.GALLERY, "9")
        blick.setzeKonto(ScopeFilter.View.PARTS, "7")
        server.enqueue(TestApi.antwort("""{"success":true,"members":[
            {"id":1,"username":"marco","is_self":true},{"id":7,"username":"kind"}]}"""))
        blick.ladeMitglieder()
        assertEquals(2, blick.konten.value.householdMembers.size)
        assertNull("Konto 9 gibt es nicht mehr", blick.kontoFuer(ScopeFilter.View.GALLERY))
        assertEquals("7", blick.kontoFuer(ScopeFilter.View.PARTS))
    }

    @Test
    fun `eine Anmeldung beginnt mit allen Konten`() = runTest {
        blick.setzeKonto(ScopeFilter.View.GALLERY, "own")
        blick.setzeLager(ScopeFilter.View.GALLERY, "Regal")
        blick.anmeldungBeginnt()
        assertTrue(ablage.konten.isEmpty() && ablage.lager.isEmpty())
        assertNull(blick.kontoFuer(ScopeFilter.View.GALLERY))
        assertNull(blick.lagerFuer(ScopeFilter.View.GALLERY))
    }
}
