package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.CatalogMetaResponse
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.Result
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
 * Der Antwort-Cache gehört Server und Sitzung: Nach einem Kontowechsel oder auf
 * einem anderen Server erscheinen offline nie die Daten eines anderen Kontos.
 * Fahrzeug ist KatalogRepository.getCatalogMeta() mit echtem Testserver und
 * echter Platte; der Bereich kommt aus einer Variablen statt aus den Prefs.
 *
 * Gegenproben (28.10.2026, gemessen mit kotlinc gegen die Datenschicht):
 *   A  fach() ohne Bereich (alle Konten in einem Ordner) → rot „ein anderes
 *      Konto sieht offline nichts …“ und „ein anderer Server …“
 *   B  in put() die anderen Bereiche nicht geräumt → rot „wer schreibt, räumt
 *      die Fächer früherer Konten“
 *   C  in cached() den Vergleich vorher/nachher entfernt → rot „wechselt das
 *      Konto während des Abrufs, wird nichts abgelegt“
 *   D  in cached() bei bereich == null trotzdem abgelegt (fester Bereich) →
 *      rot „ohne Anmeldung wird nichts abgelegt“
 *   E  den alten Ablageort nicht geräumt → rot „der alte Ablageort …“
 */
class CacheBereichTest {

    private lateinit var server: MockWebServer
    private lateinit var wurzel: File
    private lateinit var ordner: File
    private lateinit var alt: File
    private var bereiche = ArrayDeque<String?>()
    private var bereich: String? = "http://heim:3000\ntoken-a"

    /** Ein Bereich je Abfrage aus der Warteschlange, sonst der feste. */
    private val quelle: suspend () -> String? = { if (bereiche.isEmpty()) bereich else bereiche.removeFirst() }

    private fun repo() = KatalogRepository(TestApi.fuer(server),
        ResponseCache(bereichQuelle = quelle, altlast = { alt }) { ordner })

    private fun antwort(jahr: Int) =
        """{"success":true,"themes":[],"year_min":$jahr,"year_max":$jahr,"year_counts":[]}"""

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        wurzel = File(System.getProperty("java.io.tmpdir"), "bim-bereich-${System.nanoTime()}")
        ordner = File(wurzel, "nobackup").apply { mkdirs() }
        alt = File(wurzel, "cache/api-1").apply { mkdirs(); File(this, "sets.json").writeText("{}") }
    }

    @After
    fun zu() {
        runCatching { server.shutdown() }
        wurzel.deleteRecursively()
    }

    private suspend fun fuellen(r: KatalogRepository, jahr: Int) {
        server.enqueue(TestApi.antwort(antwort(jahr)))
        assertTrue(r.getCatalogMeta() is Result.Success)
    }

    private suspend fun offlineJahr(r: KatalogRepository): Int? {
        runCatching { server.shutdown() }
        return when (val x = r.getCatalogMeta()) {
            is Result.Success -> (x.data as CatalogMetaResponse).yearMin
            is Result.Error -> null
        }
    }

    private fun dateien(): List<File> = ordner.walkTopDown().filter { it.isFile }.toList()

    @Test
    fun `das eigene Konto sieht offline seine Daten`() = runTest {
        val r = repo()
        fuellen(r, 1999)
        assertEquals(1999, offlineJahr(r))
    }

    @Test
    fun `ein anderes Konto sieht offline nichts vom vorigen`() = runTest {
        val r = repo()
        fuellen(r, 1999)
        bereich = "http://heim:3000\ntoken-b"
        assertEquals(null, offlineJahr(r))
    }

    @Test
    fun `ein anderer Server sieht offline nichts`() = runTest {
        val r = repo()
        fuellen(r, 1999)
        bereich = "https://anders.example\ntoken-a"
        assertEquals(null, offlineJahr(r))
    }

    @Test
    fun `wer schreibt, raeumt die Faecher frueherer Konten`() = runTest {
        val r = repo()
        fuellen(r, 1999)
        bereich = "http://heim:3000\ntoken-b"
        fuellen(r, 2024)
        val ordnerMitDaten = dateien().map { it.parentFile.name }.toSet()
        assertEquals("Nur das Fach des aktuellen Kontos bleibt: ${dateien()}", 1, ordnerMitDaten.size)
        bereich = "http://heim:3000\ntoken-a"
        assertEquals(null, offlineJahr(r))
    }

    @Test
    fun `wechselt das Konto waehrend des Abrufs, wird nichts abgelegt`() = runTest {
        val r = repo()
        bereiche.addAll(listOf("http://heim:3000\ntoken-a", "http://heim:3000\ntoken-b"))
        fuellen(r, 1999)
        assertTrue("Abgelegt trotz Wechsel: ${dateien()}", dateien().isEmpty())
    }

    @Test
    fun `ohne Anmeldung wird nichts abgelegt`() = runTest {
        bereich = null
        fuellen(repo(), 1999)
        assertTrue("Abgelegt ohne Sitzung: ${dateien()}", dateien().isEmpty())
    }

    @Test
    fun `der alte Ablageort wird beim ersten Zugriff geraeumt`() = runTest {
        fuellen(repo(), 1999)
        assertFalse("Der alte Cache-Ordner liegt noch: $alt", alt.exists())
    }

    @Test
    fun `der Ordnername verraet weder Adresse noch Token`() {
        val name = ResponseCache.bereichsName("http://heim:3000\ntoken-a")
        assertEquals(32, name.length)
        assertFalse(name.contains("heim") || name.contains("token"))
        assertFalse(name == ResponseCache.bereichsName("http://heim:3000\ntoken-b"))
    }
}
