package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.bereichsName
import ch.brickinventoryapp.data.cache.raeumeAlteAntwortablage
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
import ch.brickinventoryapp.testing.KatalogRepository
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
 * Die Ablage gehört Server und Sitzung: Nach einem Kontowechsel oder auf einem
 * anderen Server erscheinen offline nie die Daten eines anderen Kontos. Fahrzeug ist
 * KatalogRepository.getCatalogMeta() (Fach KATALOG_META) mit echtem Testserver; der
 * Bereich kommt aus einer Variablen statt aus den Prefs.
 *
 * Gegenproben (gegenproben/):
 *   ablage-ein-bereich           uebernimm() ohne raeumeAndere() → rot „wer schreibt, räumt …“
 *   einzeln-ohne-bereichsvergleich  in abgeglichenEinzeln() den Vergleich vorher/nachher
 *                                entfernt → rot „wechselt das Konto während des Abrufs …“
 *   altablage-bleibt             raeumeAlteAntwortablage() räumt nichts → rot „der alte Ablageort …“
 *   fach-uneingeordnet           ein weiteres Fach `PROBE` in Bestandsart → rot
 *                                „die Offline-Ablage kennt genau die eingeordneten Faecher“
 */
class CacheBereichTest {

    /**
     * Was auf dem Gerät liegt, ist nach Datenklasse eingeordnet (INVARIANTEN.md,
     * „Daten auf dem Gerät“). Ein neues Fach muss dort eingeordnet werden, bevor
     * dieser Test wieder grün ist.
     */
    @Test
    fun `die Offline-Ablage kennt genau die eingeordneten Faecher`() {
        assertEquals(setOf("SETS", "MERKLISTE", "TEILE", "FIGUREN", "MANUELLE_TEILE", "MANUELLE_FIGUREN", "GUTSCHEINE",
            "PREISALARME", "LAGERORTE", "KENNZAHLEN", "KATALOG_META"),
            Bestandsart.entries.map { it.name }.toSet())
    }

    private lateinit var server: MockWebServer
    private lateinit var wurzel: File
    private val bestand = SpeicherBestand()
    private var bereiche = ArrayDeque<String?>()
    private var bereich: String? = "http://heim:3000\ntoken-a"

    /** Ein Bereich je Abfrage aus der Warteschlange, sonst der feste. */
    private val quelle: suspend () -> String? = { if (bereiche.isEmpty()) bereich else bereiche.removeFirst() }

    private fun repo() = KatalogRepository(TestApi.fuer(server), Offlineablage(bestand, SpeicherAusgang(), quelle))

    private fun antwort(jahr: Int) =
        """{"success":true,"themes":[],"year_min":$jahr,"year_max":$jahr,"year_counts":[]}"""

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        wurzel = File(System.getProperty("java.io.tmpdir"), "bim-bereich-${System.nanoTime()}").apply { mkdirs() }
    }

    @After
    fun zu() {
        runCatching { server.shutdown() }
        wurzel.deleteRecursively()
    }

    private suspend fun fuellen(r: KatalogRepository, jahr: Int) {
        server.enqueue(TestApi.antwort(antwort(jahr)))
        assertTrue(r.getCatalogMeta() is Ergebnis.Success)
    }

    private suspend fun offlineJahr(r: KatalogRepository): Int? {
        runCatching { server.shutdown() }
        return when (val x = r.getCatalogMeta()) {
            is Ergebnis.Success -> x.data.yearMin
            is Ergebnis.Error -> null
        }
    }

    /** Die Bereiche, in denen etwas liegt. */
    private suspend fun belegt(vararg kandidaten: String) =
        kandidaten.filter { bestand.lies(it, Bestandsart.KATALOG_META).liste.isNotEmpty() }

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
        val a = "http://heim:3000\ntoken-a"
        val b = "http://heim:3000\ntoken-b"
        fuellen(r, 1999)
        bereich = b
        fuellen(r, 2024)
        assertEquals("Nur das Fach des aktuellen Kontos bleibt", listOf(b), belegt(a, b))
        bereich = a
        assertEquals(null, offlineJahr(r))
    }

    @Test
    fun `wechselt das Konto waehrend des Abrufs, wird nichts abgelegt`() = runTest {
        val r = repo()
        val a = "http://heim:3000\ntoken-a"
        val b = "http://heim:3000\ntoken-b"
        bereiche.addAll(listOf(a, b))
        fuellen(r, 1999)
        assertEquals("Abgelegt trotz Wechsel", emptyList<String>(), belegt(a, b))
    }

    @Test
    fun `ohne Anmeldung wird nichts abgelegt`() = runTest {
        bereich = null
        fuellen(repo(), 1999)
        bereich = "http://heim:3000\ntoken-a"
        assertEquals(null, offlineJahr(repo()))
    }

    @Test
    fun `der alte Ablageort wird geraeumt, anderes bleibt`() {
        val noBackup = File(wurzel, "nobackup")
        val cache = File(wurzel, "cache")
        val alt = listOf(File(noBackup, "api-4/abc"), File(noBackup, "api-3"), File(cache, "api-1"))
        alt.forEach { File(it.apply { mkdirs() }, "sets.json").writeText("{}") }
        val fremd = File(noBackup, "bestand.db").apply { parentFile!!.mkdirs(); writeText("x") }
        raeumeAlteAntwortablage(noBackup, cache)
        assertEquals("Der alte Antwortspeicher liegt noch", emptyList<File>(), alt.filter { it.exists() })
        assertTrue("Was nicht dazugehört, bleibt", fremd.exists())
    }

    @Test
    fun `der Bereichsname verraet weder Adresse noch Token`() {
        val name = bereichsName("http://heim:3000\ntoken-a")
        assertEquals(32, name.length)
        assertFalse(name.contains("heim") || name.contains("token"))
        assertFalse(name == bereichsName("http://heim:3000\ntoken-b"))
    }
}
