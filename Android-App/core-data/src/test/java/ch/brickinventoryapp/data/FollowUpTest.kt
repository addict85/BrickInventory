package ch.brickinventoryapp.data

import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.MerklisteRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.vertrag.FigValuationItem
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.PartValuationItem
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.PfadServer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Auch was nur online geht, landet in der Ablage: Jeder Schreibvorgang wendet
 * die Antwort des Servers über applyAn an, damit die Listen, die allein aus der
 * Ablage lesen, sofort stimmen — ohne Signal und ohne neuen Abruf.
 *
 * Gegenproben (kotlinc und JUnit gegen die Repositories und LocalApplication.kt):
 *   A  in SetsRepositoryImpl.setSetStorage wieder nur `sicherAufrufen` → rot „Menge, Lagerort …“
 *   B  in LocalApplication.merkliste den Zweig WantedItemMoved entfernt → rot
 *      „ein verschobener und ein übernommener Merkposten …“
 *   C  in LocalApplication den Zweig PartColor auf `liste` gesetzt → rot „Lagerort und
 *      Farbe eines Teils …“
 *   D  in TeileRepositoryImpl.nameLocationUm den Nachzug weggelassen → rot „ein
 *      umbenannter Ort heisst überall neu“
 *   E  in Abruf.kt applyInSameAreaAn ohne den Vergleich des Bereichs → rot
 *      „eine Antwort, während das Konto wechselt, …“
 *   F  in nachgezogen() die Wirkung auch ohne `success` angewandt → rot „eine
 *      abgelehnte Änderung ändert die Ablage nicht“
 */
class FollowUpTest {

    // Der Testserver setzt ihn auf seinem eigenen Faden um.
    @Volatile private var bereich: String? = "a"
    private val ablage = Offlineablage(StorageInventory(), StorageExit(), { bereich })
    private val paths = PfadServer(
        "/api/v1/sets/10001-1" to """{"success":true,"quantity":3}""",
        "/api/v1/sets/10001-1/storage" to """{"success":true,"storage":"Kiste 2"}""",
        "/api/v1/sets/10001-1/move" to """{"success":true,"set_number":"10001-1"}""",
        "/api/v1/wanted/20001-1/N/inhaber" to """{"success":true,"verschoben":true}""",
        "/api/v1/wanted/20002-1/N/uebernehmen" to """{"success":true,"action":"added","set_number":"20002-1"}""",
        "/api/v1/parts/3001/5/storage" to """{"success":true,"storage":"Regal"}""",
        "/api/v1/parts/3001/5/color" to """{"success":true,"zusammengelegt":true}""",
        "/api/v1/minifigs/sw0001/storage" to """{"success":true,"storage":"Regal"}""",
        "/api/v1/storage/locations/3" to """{"success":true,"ort":{"id":3,"name":"Keller"}}""",
    )
    private val api = paths.imTakt()
    private val sets = SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val merkliste = MerklisteRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val teile = TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val figuren = FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @Before
    fun auf() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1, storage = "Kiste 1",
            owners = listOf(KontoName(id = 1, username = "anna"), KontoName(id = 2, username = "ben")))).map { it.alsAnsicht() })
        ablage.adopt(Slots.MERKLISTE, listOf(Merkposten(setNumber = "20001-1", condition = Zustand.NEU, userId = 1),
            Merkposten(setNumber = "20002-1", condition = Zustand.NEU, userId = 1)).map { it.alsAnsicht() })
        ablage.adopt(Slots.MANUELLE_TEILE, listOf(PartValuationItem(partNumber = "3001", colorId = 5, quantity = 2, storage = "Kiste 1"),
            PartValuationItem(partNumber = "3001", colorId = 7, quantity = 4)).map { it.alsAnsicht() })
        ablage.adopt(Slots.MANUELLE_FIGUREN, listOf(FigValuationItem(figNumber = "sw0001", storage = "Kiste 1")).map { it.alsAnsicht() })
    }

    @After
    fun zu() = paths.server.shutdown()

    private fun set() = runBlocking { ablage.lies(Slots.SETS)!!.liste.single { it.setNumber == "10001-1" } }

    @Test
    fun `Menge, Lagerort und Besitzer eines Sets stehen nach der Antwort in der Ablage`() = runBlocking {
        sets.setQuantity("10001-1", 5)
        assertEquals("die Zahl des Servers, nicht die gewünschte", 3, set().quantity)
        sets.setSetStorage("10001-1", "kiste 2")
        assertEquals("der Ort, wie der Server ihn schreibt", "Kiste 2", set().storage)
        sets.moveSet("10001-1", fromUserId = 1, toUserId = 2)
        assertEquals(listOf(2), set().owners.map { it.id })
        sets.deleteSet("10001-1")
        assertEquals(emptyList<String>(), ablage.lies(Slots.SETS)!!.liste.map { it.setNumber })
    }

    @Test
    fun `ein verschobener und ein uebernommener Merkposten stehen nach der Antwort in der Ablage`() = runBlocking {
        merkliste.moveWantedItem("20001-1", Zustand.NEU, ofId = 1, toId = 2)
        merkliste.adoptWantedItem("20002-1", Zustand.NEU, quantity = 2, ownerUserId = 1)
        assertEquals(listOf("20001-1|2"), ablage.lies(Slots.MERKLISTE)!!.liste.map { "${it.setNumber}|${it.userId}" })
        assertEquals("übernommen in die Galerie", listOf("20002-1" to 2, "10001-1" to 1),
            ablage.lies(Slots.SETS)!!.liste.map { it.setNumber to it.quantity })
    }

    @Test
    fun `Lagerort und Farbe eines Teils und der Ort einer Figur stehen nach der Antwort in der Ablage`() = runBlocking {
        teile.setPartStorage("3001", 5, "regal")
        assertEquals("Regal", ablage.lies(Slots.MANUELLE_TEILE)!!.liste.first { it.colorId == 5 }.storage)
        // Die neue Farbe hat schon eine Zeile: Der Server legt beide zusammen.
        teile.setPartColor("3001", 5, neueFarbe = 7, farbName = "Grün", farbHex = "00FF00")
        assertEquals(listOf(7 to 6), ablage.lies(Slots.MANUELLE_TEILE)!!.liste.map { it.colorId to it.quantity })
        figuren.setFigStorage("sw0001", "regal")
        assertEquals("Regal", ablage.lies(Slots.MANUELLE_FIGUREN)!!.liste.single().storage)
    }

    @Test
    fun `ein umbenannter Ort heisst ueberall neu`() = runBlocking {
        teile.nameLocationUm(3, alt = "Kiste 1", name = "Keller")
        assertEquals("Keller", set().storage)
        assertEquals("Keller", ablage.lies(Slots.MANUELLE_TEILE)!!.liste.first { it.colorId == 5 }.storage)
        assertEquals("Keller", ablage.lies(Slots.MANUELLE_FIGUREN)!!.liste.single().storage)
    }

    @Test
    fun `eine Antwort, waehrend das Konto wechselt, aendert die neue Ablage nicht`() = runBlocking {
        // Das Gerät hält nur ein Konto; das neue lädt sein Set, während die alte Antwort unterwegs ist.
        paths.priority = { _, _ ->
            bereich = "b"
            runBlocking { ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1)).map { it.alsAnsicht() }) }
            null
        }
        sets.setQuantity("10001-1", 5)
        assertEquals("die Ablage des neuen Kontos", 1, set().quantity)
    }

    @Test
    fun `eine abgelehnte Aenderung aendert die Ablage nicht`() = runBlocking {
        paths.antworten["/api/v1/sets/10001-1/storage"] = """{"success":false,"error":"Ort unbekannt"}"""
        sets.setSetStorage("10001-1", "x")
        assertEquals("Kiste 1", set().storage)
    }
}
