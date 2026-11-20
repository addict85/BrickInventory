package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.Setsortierung
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.PartsResponse
import ch.brickinventoryapp.contract.ManualPartsResponse
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.SetsResponse
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.RoomExit
import ch.brickinventoryapp.offline.room.RoomInventory
import kotlinx.coroutines.flow.first
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
 * Suche und Filter beantwortet Room, online wie ohne Netz — mit denselben
 * Abfragen wie im Gerät, gegen eine Api-Attrappe, die online Seiten liefert und
 * offline mit ConnectException scheitert. Läuft nur in der CI.
 *
 * Gegenproben (gegenproben/, der CI-Job `gegenproben` verlangt Rot):
 *   ohne-netz-suche-als-muster `%` und `_` nicht maskiert → rot „ein Prozentzeichen …“
 *   ohne-netz-filter-spalte    die Spalte thema bekommt den Lagerort → rot „Suche, Thema …“
 *   galerie-ablage-ungefiltert observeSets übergibt keine Filterspalten → rot „die Galerie filtert in Room …“
 *   teile-nur-seite-eins       refreshPaged bricht nach Seite 1 ab → rot „alle Seiten der Teile …“
 *   teile-farbwahl-verloren    observeParts reicht die Farbwahl nicht weiter → rot „Farbe, Kategorie, Ersatzteile …“
 */
@RunWith(RobolectricTestRunner::class)
class WithoutNetworkFilterTest {

    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), InventoryDatabase::class.java)
        .allowMainThreadQueries().build()
    private val bestand = RoomInventory(db)
    private val ablage = Offlineablage(bestand, RoomExit(db), { "a" }, clock = { STATUS })

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

    private val setsApi = object : SetsApi by fake<SetsApi>() {
        override suspend fun getSets(accounts: String?, search: String?, theme: String?, sort: String?, page: Int?,
                                     pageSize: Int?, storage: String?): Response<SetsResponse> {
            if (offline) throw ConnectException("aus")
            val n = pageSize ?: sets.size
            val seite = sets.drop(((page ?: 1) - 1) * n).take(n)
            return Response.success(SetsResponse(success = true, count = seite.size, sets = seite, total = sets.size))
        }
    }
    private val setsRepo = SetsRepositoryImpl(setsApi, ablage, Wiederholung.EINMAL)

    private val teile = listOf(
        Part(partNumber = "3001", partName = "Brick 2 x 4", colorId = 4, colorName = "Red", categoryName = "11"),
        Part(partNumber = "3001", partName = "Brick 2 x 4", colorId = 1, colorName = "Blue", categoryName = "11"),
        Part(partNumber = "3023", partName = "Plate 1 x 2", colorId = 4, colorName = "Red", categoryName = "14", isSpare = true),
        Part(partNumber = "3069b", blPartNumber = "87079", partName = "Tile 1 x 2", colorId = 1, colorName = "Blue",
            categoryName = "19"),
    )

    private val partsApi = object : PartsApi by fake<PartsApi>() {
        override suspend fun getParts(search: String?, color: String?, category: String?, page: Int, pageSize: Int,
                                      setNumber: String?, excludeManual: String?, accounts: String?, spare: String?,
                                      withSets: String?, storage: String?): Response<PartsResponse> {
            if (offline) throw ConnectException("aus")
            // Zwei je Seite: So liegt die lokale Liste erst nach Seite 2 ganz da.
            val seite = teile.drop((page - 1) * 2).take(2)
            return Response.success(PartsResponse(success = true, total = teile.size, parts = seite))
        }
        override suspend fun getManualParts(accounts: String?, search: String?, storage: String?): Response<ManualPartsResponse> {
            if (offline) throw ConnectException("aus")
            return Response.success(ManualPartsResponse(success = true, parts = listOf(PartValuationItem(partNumber = "m1"))))
        }
    }
    private val partsRepo = TeileRepositoryImpl(partsApi, ablage, Wiederholung.EINMAL)

    private fun setsOffline(search: String? = null, theme: String? = null, storage: String? = null, sort: Setsortierung? = null) =
        runBlocking { setsRepo.observeSets(search, theme, storage, sort).first() }
            .also { assertEquals("trägt den Stand", STATUS, it.stand) }
            .liste.map { it.setNumber }

    private fun partsOffline(search: String? = null, color: String? = null, category: String? = null,
                             spare: Ersatzteilwahl = Ersatzteilwahl.ALLE) =
        runBlocking { partsRepo.observeParts(search, ColorPicker.aus(color), Kategoriewahl.aus(category), spare).first() }
            .liste.map { "${it.partNumber}/${it.colorName}" }

    private fun loadSetsOnline() = runBlocking { assertTrue(setsRepo.aktualisiereSets() is Ergebnis.Erfolg) }

    @Test
    fun `Suche, Thema, Lagerort und Sortierung der Galerie wirken ohne Netz auf die ganze lokale Liste`() {
        loadSetsOnline()
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
        loadSetsOnline()
        offline = true
        assertEquals(listOf("30000-1"), setsOffline(search = "50_%"))
        assertEquals("„_“ ist kein Platzhalter für ein Zeichen", emptyList<String>(), setsOffline(search = "Burg_am"))
    }

    @Test
    fun `Farbe, Kategorie, Ersatzteile und Suche der Teileliste wirken ohne Netz`() {
        runBlocking { assertTrue(partsRepo.refreshParts() is Ergebnis.Erfolg) }
        offline = true
        assertEquals(listOf("3001/Red", "3023/Red"), partsOffline(color = "Red"))
        assertEquals(listOf("3001/Red"), partsOffline(color = "Red", spare = Ersatzteilwahl.OHNE))
        assertEquals(listOf("3023/Red"), partsOffline(spare = Ersatzteilwahl.NUR))
        assertEquals(listOf("3069b/Blue"), partsOffline(category = "19"))
        assertEquals("Suche im Namen", listOf("3023/Red"), partsOffline(search = "plate"))
        assertEquals("Suche in der BrickLink-Nummer", listOf("3069b/Blue"), partsOffline(search = "87079"))
        assertEquals(listOf("3001/Red", "3001/Blue"), partsOffline(search = "3001"))
    }

    @Test
    fun `die Galerie filtert in Room, der Abruf fuellt nur die Ablage`() = runBlocking {
        assertTrue(setsRepo.aktualisiereSets() is Ergebnis.Erfolg)
        assertEquals("alle Sets in der Ablage", sets.size, setsRepo.observeSets().first().liste.size)
        val city = setsRepo.observeSets(thema = "City", sort = Setsortierung.NUMMER).first().liste.map { it.setNumber }
        assertEquals("die Galerie filtert in Room und sortiert wie der Server", listOf("10002-1", "21000-1"), city)
        offline = true
        assertTrue("ohne Netz meldet der Abruf den Fehler", setsRepo.aktualisiereSets() is Ergebnis.Fehler)
        assertEquals("und die Ablage bleibt", sets.size, setsRepo.observeSets().first().liste.size)
    }

    @Test
    fun `die Teile kommen ganz in die Ablage und filtern dort`() = runBlocking {
        assertTrue(partsRepo.refreshParts() is Ergebnis.Erfolg)
        assertEquals("alle Seiten der Teile in der Ablage", teile.size, partsRepo.observeParts().first().liste.size)
        assertEquals("die manuellen Teile ebenso", listOf("m1"), partsRepo.observeManualParts().first().liste.map { it.partNumber })
        val rot = partsRepo.observeParts(farbe = ColorPicker.Farbe("Red"), spareParts = Ersatzteilwahl.OHNE).first().liste.map { it.partNumber }
        assertEquals("Farbe und Ersatzteile filtern in Room", listOf("3001"), rot)
    }

    private companion object {
        const val STATUS = 42L

        /** Jede nicht überschriebene Methode der Schnittstelle ist hier ein Fehler des Tests. */
        inline fun <reified A> fake(): A = Proxy.newProxyInstance(A::class.java.classLoader, arrayOf(A::class.java)) { _, m, _ ->
            error("unerwarteter Aufruf ${m.name}")
        } as A
    }
}
