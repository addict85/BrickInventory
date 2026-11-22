package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.areaName
import ch.brickinventoryapp.data.cache.cleanOldResponseStore
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.TestApi
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * The store belongs to server and session: after an account switch or on another
 * server the data of another account never appears offline. The vehicle is
 * CatalogRepository.getCatalogMeta() (compartment KATALOG_META) with a real test server; the
 * area comes from a variable instead of from the prefs.
 *
 * Counter-checks (gegenproben/):
 *   ablage-ein-bereich           uebernimm() without cleanOther() → red “whoever writes clears …”
 *   einzeln-ohne-bereichsvergleich  in reconciledSingle() the before/after comparison
 *                                removed → red “if the account changes during the fetch …”
 *   altablage-bleibt             cleanOldResponseStore() clears nothing → red “the old storage location …”
 *   fach-uneingeordnet           a further compartment `PROBE` in Bestandsart → red
 *                                “the offline store knows exactly the classified compartments“
 */
class CacheAreaTest {

    /**
     * What lies on the device is classified by data class (INVARIANTEN.md,
     * „Daten auf dem Gerät“). A new compartment must be classified there before
     * this test is green again.
     */
    @Test
    fun `the offline store knows exactly the classified compartments`() {
        assertEquals(setOf("SETS", "MERKLISTE", "TEILE", "FIGUREN", "MANUELLE_TEILE", "MANUELLE_FIGUREN", "GUTSCHEINE",
            "PREISALARME", "LAGERORTE", "KENNZAHLEN", "KATALOG_META"),
            StockKind.entries.map { it.name }.toSet())
    }

    private lateinit var server: MockWebServer
    private lateinit var root: File
    private val bestand = StorageInventory()
    private var areas = ArrayDeque<String?>()
    private var bereich: String? = "http://heim:3000\ntoken-a"

    /** One area per query from the queue, otherwise the fixed one. */
    private val quelle: suspend () -> String? = { if (areas.isEmpty()) bereich else areas.removeFirst() }

    private fun repo() = testCatalogRepository(TestApi.fuer(server), Offlineablage(bestand, StorageExit(), quelle))

    private fun antwort(jahr: Int) =
        """{"success":true,"themes":[],"year_min":$jahr,"year_max":$jahr,"year_counts":[]}"""

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        root = File(System.getProperty("java.io.tmpdir"), "bim-bereich-${System.nanoTime()}").apply { mkdirs() }
    }

    @After
    fun zu() {
        runCatching { server.shutdown() }
        root.deleteRecursively()
    }

    private suspend fun fill(r: CatalogRepository, jahr: Int) {
        server.enqueue(TestApi.antwort(antwort(jahr)))
        assertTrue(r.getCatalogMeta() is Ergebnis.Erfolg)
    }

    private suspend fun offlineYear(r: CatalogRepository): Int? {
        runCatching { server.shutdown() }
        return when (val x = r.getCatalogMeta()) {
            is Ergebnis.Erfolg -> x.data.jahrMin
            is Ergebnis.Fehler -> null
        }
    }

    /** Die Bereiche, in denen etwas liegt. */
    private suspend fun belegt(vararg candidates: String) =
        candidates.filter { bestand.lies(it, StockKind.KATALOG_META).liste.isNotEmpty() }

    @Test
    fun `the own account sees its data offline`() = runTest {
        val r = repo()
        fill(r, 1999)
        assertEquals(1999, offlineYear(r))
    }

    @Test
    fun `a different account sees nothing of the previous one offline`() = runTest {
        val r = repo()
        fill(r, 1999)
        bereich = "http://heim:3000\ntoken-b"
        assertEquals(null, offlineYear(r))
    }

    @Test
    fun `a different server sees nothing offline`() = runTest {
        val r = repo()
        fill(r, 1999)
        bereich = "https://anders.example\ntoken-a"
        assertEquals(null, offlineYear(r))
    }

    @Test
    fun `whoever writes clears the compartments of earlier accounts`() = runTest {
        val r = repo()
        val a = "http://heim:3000\ntoken-a"
        val b = "http://heim:3000\ntoken-b"
        fill(r, 1999)
        bereich = b
        fill(r, 2024)
        assertEquals("Nur das Fach des aktuellen Kontos bleibt", listOf(b), belegt(a, b))
        bereich = a
        assertEquals(null, offlineYear(r))
    }

    @Test
    fun `if the account changes during the fetch, nothing is stored`() = runTest {
        val r = repo()
        val a = "http://heim:3000\ntoken-a"
        val b = "http://heim:3000\ntoken-b"
        areas.addAll(listOf(a, b))
        fill(r, 1999)
        assertEquals("Abgelegt trotz Wechsel", emptyList<String>(), belegt(a, b))
    }

    @Test
    fun `without sign-in nothing is stored`() = runTest {
        bereich = null
        fill(repo(), 1999)
        bereich = "http://heim:3000\ntoken-a"
        assertEquals(null, offlineYear(repo()))
    }

    @Test
    fun `the old storage location is cleared, other things stay`() {
        val noBackup = File(root, "nobackup")
        val cache = File(root, "cache")
        val alt = listOf(File(noBackup, "api-4/abc"), File(noBackup, "api-3"), File(cache, "api-1"))
        alt.forEach { File(it.apply { mkdirs() }, "sets.json").writeText("{}") }
        val fremd = File(noBackup, "bestand.db").apply { parentFile!!.mkdirs(); writeText("x") }
        cleanOldResponseStore(noBackup, cache)
        assertEquals("Der alte Antwortspeicher liegt noch", emptyList<File>(), alt.filter { it.exists() })
        assertTrue("Was nicht dazugehört, bleibt", fremd.exists())
    }

    @Test
    fun `the area name reveals neither address nor token`() {
        val name = areaName("http://heim:3000\ntoken-a")
        assertEquals(32, name.length)
        assertFalse(name.contains("heim") || name.contains("token"))
        assertFalse(name == areaName("http://heim:3000\ntoken-b"))
    }
}
