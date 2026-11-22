package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.areaName
import ch.brickinventoryapp.data.cache.cleanOldResponseStore
import ch.brickinventoryapp.data.catalog.CatalogRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
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
 * CatalogRepository.getCatalogMeta() (compartment CATALOG_META) with a real test server; the
 * area comes from a variable instead of from the prefs.
 *
 * Counter-checks (counter-checks/):
 *   ablage-ein-bereich           uebernimm() without cleanOther() → red “whoever writes clears …”
 *   einzeln-ohne-bereichsvergleich  in reconciledSingle() the before/after comparison
 *                                removed → red “if the account changes during the fetch …”
 *   altablage-bleibt             cleanOldResponseStore() clears nothing → red “the old storage location …”
 *   fach-uneingeordnet           a further compartment `PROBE` in Bestandsart → red
 *                                “the offline store knows exactly the classified compartments“
 */
class CacheAreaTest {

    /**
     * What lies on the device is classified by data class (`INVARIANTEN.md`,
     * „Daten auf dem Gerät“). A new compartment must be classified there before
     * this test is green again.
     */
    @Test
    fun `the offline store knows exactly the classified compartments`() {
        assertEquals(setOf("SETS", "WANTED_LIST", "PARTS", "FIGURES", "MANUAL_PARTS", "MANUAL_FIGURES", "VOUCHERS",
            "PRICE_ALARMS", "STORAGE_LOCATIONS", "METRICS", "CATALOG_META"),
            StockKind.entries.map { it.name }.toSet())
    }

    private lateinit var server: MockWebServer
    private lateinit var root: File
    private val stock = StorageInventory()
    private var areas = ArrayDeque<String?>()
    private var area: String? = "http://heim:3000\ntoken-a"

    /** One area per query from the queue, otherwise the fixed one. */
    private val source: suspend () -> String? = { if (areas.isEmpty()) area else areas.removeFirst() }

    private fun repo() = testCatalogRepository(TestApi.forTarget(server), OfflineStore(stock, OutboxStorage(), source))

    private fun response(year: Int) =
        """{"success":true,"themes":[],"year_min":$year,"year_max":$year,"year_counts":[]}"""

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        root = File(System.getProperty("java.io.tmpdir"), "bim-bereich-${System.nanoTime()}").apply { mkdirs() }
    }

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        root.deleteRecursively()
    }

    private suspend fun fill(r: CatalogRepository, year: Int) {
        server.enqueue(TestApi.response(response(year)))
        assertTrue(r.getCatalogMeta() is Outcome.Success)
    }

    private suspend fun offlineYear(r: CatalogRepository): Int? {
        runCatching { server.shutdown() }
        return when (val x = r.getCatalogMeta()) {
            is Outcome.Success -> x.data.yearMin
            is Outcome.Failure -> null
        }
    }

    /** Die Bereiche, in denen etwas liegt. */
    private suspend fun occupied(vararg candidates: String) =
        candidates.filter { stock.read(it, StockKind.CATALOG_META).list.isNotEmpty() }

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
        area = "http://heim:3000\ntoken-b"
        assertEquals(null, offlineYear(r))
    }

    @Test
    fun `a different server sees nothing offline`() = runTest {
        val r = repo()
        fill(r, 1999)
        area = "https://anders.example\ntoken-a"
        assertEquals(null, offlineYear(r))
    }

    @Test
    fun `whoever writes clears the compartments of earlier accounts`() = runTest {
        val r = repo()
        val a = "http://heim:3000\ntoken-a"
        val b = "http://heim:3000\ntoken-b"
        fill(r, 1999)
        area = b
        fill(r, 2024)
        assertEquals("Nur das Fach des aktuellen Kontos bleibt", listOf(b), occupied(a, b))
        area = a
        assertEquals(null, offlineYear(r))
    }

    @Test
    fun `if the account changes during the fetch, nothing is stored`() = runTest {
        val r = repo()
        val a = "http://heim:3000\ntoken-a"
        val b = "http://heim:3000\ntoken-b"
        areas.addAll(listOf(a, b))
        fill(r, 1999)
        assertEquals("Abgelegt trotz Wechsel", emptyList<String>(), occupied(a, b))
    }

    @Test
    fun `without sign-in nothing is stored`() = runTest {
        area = null
        fill(repo(), 1999)
        area = "http://heim:3000\ntoken-a"
        assertEquals(null, offlineYear(repo()))
    }

    @Test
    fun `the old storage location is cleared, other things stay`() {
        val noBackup = File(root, "nobackup")
        val cache = File(root, "cache")
        val old = listOf(File(noBackup, "api-4/abc"), File(noBackup, "api-3"), File(cache, "api-1"))
        old.forEach { File(it.apply { mkdirs() }, "sets.json").writeText("{}") }
        val foreign = File(noBackup, "bestand.db").apply { parentFile!!.mkdirs(); writeText("x") }
        cleanOldResponseStore(noBackup, cache)
        assertEquals("Der alte Antwortspeicher liegt noch", emptyList<File>(), old.filter { it.exists() })
        assertTrue("Was nicht dazugehört, bleibt", foreign.exists())
    }

    @Test
    fun `the area name reveals neither address nor token`() {
        val name = areaName("http://heim:3000\ntoken-a")
        assertEquals(32, name.length)
        assertFalse(name.contains("heim") || name.contains("token"))
        assertFalse(name == areaName("http://heim:3000\ntoken-b"))
    }
}
