package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.lokal.Lokal
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartsResponse
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.data.model.SetsResponse
import ch.brickinventoryapp.offline.room.BestandDatenbank
import ch.brickinventoryapp.offline.room.RoomAusgang
import ch.brickinventoryapp.offline.room.RoomBestand
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import retrofit2.Response
import java.lang.reflect.Proxy
import java.net.ConnectException

/**
 * Ohne Netz beantworten die Repositories Suche und Filter aus Room — mit
 * denselben Abfragen wie im Gerät, gegen eine Api-Attrappe, die online Seiten
 * liefert und offline mit ConnectException scheitert. Läuft nur in der CI.
 *
 * Gegenproben (gegenproben/, der CI-Job `gegenproben` verlangt Rot):
 *   ohne-netz-ohne-filter      gefiltert() gibt den Netzfehler zurück → rot „Suche, Thema …“ und „Farbe, …“
 *   ohne-netz-suche-als-muster `%` und `_` nicht maskiert → rot „ein Prozentzeichen …“
 *   ohne-netz-filter-spalte    die Spalte thema bekommt den Lagerort → rot „Suche, Thema …“
 *   seite-kodiert-ganze-liste  uebernimm liest und ersetzt beim Anhängen die ganze Liste →
 *                              rot „eine weitere Seite schreibt nur ihre Zeilen“
 *   seite-ohne-ausgang         beim Anhängen wird der Ausgang nicht angewandt → rot „die Serverzeile trägt …“
 */
@RunWith(RobolectricTestRunner::class)
class OhneNetzFilterTest {

    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), BestandDatenbank::class.java)
        .allowMainThreadQueries().build()
    private val bestand = Zaehlend(RoomBestand(db))
    private val ablage = Offlineablage(bestand, RoomAusgang(db), { "a" }, uhr = { STAND })

    private var offline = false

    @After
    fun zu() = db.close()

    private val sets = listOf(
        SetItem(setNumber = "10001-1", name = "Burg am See", theme = "Castle", storage = "Kiste 1", year = 2001),
        SetItem(setNumber = "10002-1", name = "Polizeiwache", theme = "City", storage = "Kiste 2", year = 2010),
        SetItem(setNumber = "10003-1", name = "Seeräuber", theme = "Pirates", storage = "Kiste 1", year = 1999),
        SetItem(setNumber = "21000-1", name = "Bahnhof", theme = "City", year = null),
        SetItem(setNumber = "30000-1", name = "Rabatt 50_%", theme = "Promo", year = 2020),
    )

    private val setsApi = object : SetsApi by attrappe<SetsApi>() {
        override suspend fun getSets(accounts: String?, search: String?, theme: String?, sort: String?, page: Int?,
                                     pageSize: Int?, storage: String?): Response<SetsResponse> {
            if (offline) throw ConnectException("aus")
            val n = pageSize ?: sets.size
            val seite = sets.drop(((page ?: 1) - 1) * n).take(n)
            return Response.success(SetsResponse(success = true, count = seite.size, sets = seite, total = sets.size))
        }
    }
    private val setsRepo = SetsRepositoryImpl(setsApi, ablage)

    private val teile = listOf(
        Part(partNumber = "3001", partName = "Brick 2 x 4", colorId = 4, colorName = "Red", categoryName = "11"),
        Part(partNumber = "3001", partName = "Brick 2 x 4", colorId = 1, colorName = "Blue", categoryName = "11"),
        Part(partNumber = "3023", partName = "Plate 1 x 2", colorId = 4, colorName = "Red", categoryName = "14", isSpare = true),
        Part(partNumber = "3069b", blPartNumber = "87079", partName = "Tile 1 x 2", colorId = 1, colorName = "Blue",
            categoryName = "19"),
    )

    private val teileApi = object : TeileApi by attrappe<TeileApi>() {
        override suspend fun getParts(search: String?, color: String?, category: String?, page: Int, pageSize: Int,
                                      setNumber: String?, excludeManual: String?, accounts: String?, spare: String?,
                                      withSets: String?, storage: String?): Response<PartsResponse> {
            if (offline) throw ConnectException("aus")
            // Zwei je Seite: So liegt die lokale Liste erst nach Seite 2 ganz da.
            val seite = teile.drop((page - 1) * 2).take(2)
            return Response.success(PartsResponse(success = true, total = teile.size, parts = seite))
        }
    }
    private val teileRepo = TeileRepositoryImpl(teileApi, ablage)

    private fun setsOffline(search: String? = null, theme: String? = null, storage: String? = null, sort: Setsortierung? = null) =
        runBlocking { setsRepo.getSets(null, search, theme, sort, 1, 2, storage) }
            .let { it as Ergebnis.Success }.also { assertEquals("trägt den Stand", STAND, it.stand) }
            .data.sets.map { it.setNumber }

    private fun teileOffline(search: String? = null, color: String? = null, category: String? = null,
                             spare: Ersatzteilwahl = Ersatzteilwahl.ALLE) =
        runBlocking { teileRepo.getParts(search, color, category, 1, null, spare, false, null) }
            .let { it as Ergebnis.Success }.data.parts.map { "${it.partNumber}/${it.colorName}" }

    private fun ladeSetsOnline() = runBlocking {
        for (seite in 1..3) assertTrue(setsRepo.getSets(null, null, null, null, seite, 2, null) is Ergebnis.Success)
    }

    @Test
    fun `Suche, Thema, Lagerort und Sortierung der Galerie wirken ohne Netz auf die ganze lokale Liste`() {
        ladeSetsOnline()
        offline = true
        assertEquals("Suche ohne Gross und Klein, über Seite 2 hinweg", listOf("10001-1", "10003-1"), setsOffline(search = "SEE"))
        assertEquals("Suche im Jahr", listOf("10002-1"), setsOffline(search = "2010"))
        assertEquals("Thema", listOf("10002-1", "21000-1"), setsOffline(theme = "City"))
        assertEquals("Lagerort", listOf("10001-1", "10003-1"), setsOffline(storage = "Kiste 1"))
        assertEquals("Thema und Lagerort zusammen", listOf("10001-1"), setsOffline(theme = "Castle", storage = "Kiste 1"))
        assertEquals("Sortierung nach Name", listOf("21000-1", "10001-1", "10002-1", "30000-1", "10003-1"),
            setsOffline(sort = Setsortierung.NAME))
    }

    @Test
    fun `ein Prozentzeichen oder Unterstrich in der Suche gilt wörtlich`() {
        ladeSetsOnline()
        offline = true
        assertEquals(listOf("30000-1"), setsOffline(search = "50_%"))
        assertEquals("„_“ ist kein Platzhalter für ein Zeichen", emptyList<String>(), setsOffline(search = "Burg_am"))
    }

    @Test
    fun `Farbe, Kategorie, Ersatzteile und Suche der Teileliste wirken ohne Netz`() {
        runBlocking { for (seite in 1..2) teileRepo.getParts(null, null, null, seite, null, Ersatzteilwahl.ALLE, false, null) }
        offline = true
        assertEquals(listOf("3001/Red", "3023/Red"), teileOffline(color = "Red"))
        assertEquals(listOf("3001/Red"), teileOffline(color = "Red", spare = Ersatzteilwahl.OHNE))
        assertEquals(listOf("3023/Red"), teileOffline(spare = Ersatzteilwahl.NUR))
        assertEquals(listOf("3069b/Blue"), teileOffline(category = "19"))
        assertEquals("Suche im Namen", listOf("3023/Red"), teileOffline(search = "plate"))
        assertEquals("Suche in der BrickLink-Nummer", listOf("3069b/Blue"), teileOffline(search = "87079"))
        assertEquals(listOf("3001/Red", "3001/Blue"), teileOffline(search = "3001"))
    }

    @Test
    fun `eine weitere Seite schreibt nur ihre Zeilen und liest die Liste nicht`() {
        ladeSetsOnline()
        assertEquals("Seite 1 ersetzt die Liste", listOf(2), bestand.ersetzt)
        assertEquals("Seiten 2 und 3 schreiben nur ihre eigenen Zeilen", listOf(2, 1), bestand.angehaengt)
        assertEquals("gelesen wird dabei nichts", 0, bestand.gelesen)
        assertEquals(sets.map { it.setNumber }, runBlocking { ablage.lies(Faecher.SETS) }!!.liste.map { it.setNumber })
    }

    @Test
    fun `der Ausgang wirkt auch auf eine weitere Seite, ohne Zeilen doppelt anzulegen`() {
        runBlocking {
            setsRepo.getSets(null, null, null, null, 1, 2, null)
            // Offline ein Set erfasst, das der Server auf Seite 2 schon führt: Lokal steht
            // es erst vorn, die Zeile von Seite 2 ersetzt es samt wartendem Schritt.
            ablage.puffere(Bearbeitung.SetErfassen(AddSetRequest(setNumber = "10003-1", quantity = 1)))
            setsRepo.getSets(null, null, null, null, 2, 2, null)
        }
        val lokal = runBlocking { ablage.lies(Faecher.SETS) }!!.liste
        assertEquals(listOf("10001-1", "10002-1", "10003-1", "21000-1"), lokal.map { it.setNumber })
        assertEquals("die Serverzeile trägt die wartende Erfassung aus dem Ausgang", 2,
            lokal.single { it.setNumber == "10003-1" }.quantity)
    }

    /** Zählt, was die Ablage mit dem Bestand tut — die Seitenübernahme ist so von aussen sichtbar. */
    private class Zaehlend(private val innen: LokalerBestand) : LokalerBestand by innen {
        val ersetzt = mutableListOf<Int>()
        val angehaengt = mutableListOf<Int>()
        var gelesen = 0

        override suspend fun lies(bereich: String, art: Bestandsart): Lokal<LokaleZeile> = innen.lies(bereich, art).also { gelesen++ }
        override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) {
            if (stand != null) ersetzt += zeilen.size
            innen.ersetze(bereich, art, zeilen, stand)
        }
        override suspend fun haengeAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, weg: Set<String>, stand: Long) {
            angehaengt += zeilen.size
            innen.haengeAn(bereich, art, zeilen, weg, stand)
        }
    }

    private companion object {
        const val STAND = 42L

        /** Jede nicht überschriebene Methode der Schnittstelle ist hier ein Fehler des Tests. */
        inline fun <reified A> attrappe(): A = Proxy.newProxyInstance(A::class.java.classLoader, arrayOf(A::class.java)) { _, m, _ ->
            error("unerwarteter Aufruf ${m.name}")
        } as A
    }
}
