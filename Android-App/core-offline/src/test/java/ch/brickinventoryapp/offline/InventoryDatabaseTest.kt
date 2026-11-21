package ch.brickinventoryapp.offline

import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.local.StockKind
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.local.Abgleich
import ch.brickinventoryapp.data.local.Abgleichsergebnis
import ch.brickinventoryapp.data.local.Sendeergebnis
import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import ch.brickinventoryapp.offline.room.ExitRow
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.RoomExit
import ch.brickinventoryapp.offline.room.RoomInventory
import ch.brickinventoryapp.contract.SetItem
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The Room store itself (only in CI: Room needs Android). The same
 * promises as the in-memory stores, against a real SQLite database.
 *
 * Counter-checks: to be measured in CI as soon as the run is green —
 *   A  in InventoryDao.beobachte remove `ORDER BY position` → “keeps the order”
 *   B  in ExitDao.alle `ORDER BY id` → `ORDER BY id DESC` → “sends in order”
 *   C  in RoomExit.cleanUnreadable strike the rememberDiscarded → “an unreadable item is
 *      reported …” (no hint); in RoomExit.alle remove again → same place (reading writes)
 *   D  in RoomExit.lies `z.schluessel` → `""` → “an unreadable item …” (key does not come back)
 *   gegenproben/ablage-aendert-ganze-liste.patch (Offlineablage.aendere replaces the
 *      whole list again) → red “a local edit writes only the affected row”
 *   gegenproben/verworfen-nie-quittiert.patch (RoomExit.acknowledgeDiscarded deletes nothing)
 *      → red “a discarded item stays in the database until …”
 */
@RunWith(RobolectricTestRunner::class)
class InventoryDatabaseTest {

    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), InventoryDatabase::class.java)
        .allowMainThreadQueries().build()
    private val bestand = RoomInventory(db)
    private val ausgang = RoomExit(db)

    @After
    fun zu() = db.close()

    @Test
    fun `keeps the order and the state per area`() = runBlocking {
        bestand.ersetze("a", StockKind.SETS, listOf(LocalRow("2", "{}"), LocalRow("1", "{}")), 42L)
        bestand.ersetze("b", StockKind.SETS, listOf(LocalRow("9", "{}")), 7L)
        val a = bestand.observe("a", StockKind.SETS).first()
        assertEquals(listOf("2", "1"), a.liste.map { it.schluessel })
        assertEquals(42L, a.stand)
        bestand.cleanOther("a")
        assertEquals(emptyList<LocalRow>(), bestand.lies("b", StockKind.SETS).liste)
        assertNull(bestand.lies("b", StockKind.SETS).stand)
    }

    @Test
    fun `a local change keeps the server state`() = runBlocking {
        bestand.ersetze("a", StockKind.SETS, listOf(LocalRow("1", "{}")), 42L)
        bestand.ersetze("a", StockKind.SETS, listOf(LocalRow("1", "{}"), LocalRow("2", "{}")), null)
        assertEquals(42L, bestand.lies("a", StockKind.SETS).stand)
    }

    @Test
    fun `sends in order and counts attempts`() = runBlocking {
        val ablage = Offlineablage(bestand, ausgang, { "a" })
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "1-1", quantity = 1)).map { it.alsAnsicht() })
        for (n in 1..3) ablage.buffer(Editing.SetMenge("1-1", n))
        assertEquals(3, ausgang.anzahl("a").first())
        assertEquals(7, ablage.lies(Slots.SETS)!!.liste.single().quantity)
        val gesendet = mutableListOf<Int>()
        var netz = false
        val schluessel = mutableSetOf<String>()
        val sync = Abgleich(ablage, ausgang) { b, k ->
            schluessel += k
            if (!netz) Sendeergebnis.Later else { gesendet += (b as Editing.SetMenge).schritt; Sendeergebnis.Angenommen }
        }
        assertEquals(Abgleichsergebnis.LATER, sync.send())
        assertEquals(1, ausgang.erster("a")!!.versuche)
        netz = true
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        assertEquals(listOf(1, 2, 3), gesendet)
        assertEquals("der erste Posten trug bei beiden Versuchen denselben Schlüssel", 3, schluessel.size)
        assertEquals(0, ausgang.anzahl("a").first())
    }

    /** Writes every INSERT, UPDATE and DELETE on `bestand` into a log table. */
    private fun writeLog(): () -> List<String> {
        val sql = db.openHelper.writableDatabase
        sql.execSQL("CREATE TABLE protokoll (was TEXT NOT NULL)")
        for (art in listOf("INSERT", "UPDATE", "DELETE")) {
            val zeile = if (art == "DELETE") "old" else "new"
            sql.execSQL("CREATE TRIGGER protokoll_$art AFTER $art ON bestand BEGIN " +
                "INSERT INTO protokoll VALUES ('$art ' || $zeile.schluessel); END")
        }
        return {
            sql.query("SELECT was FROM protokoll ORDER BY rowid").use { c ->
                buildList { while (c.moveToNext()) add(c.getString(0)) }
            }
        }
    }

    @Test
    fun `a local edit writes only the affected row`() = runBlocking {
        val ablage = Offlineablage(bestand, ausgang, { "a" })
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "1-1", quantity = 1), SetItem(setNumber = "2-1", quantity = 1), SetItem(setNumber = "3-1", quantity = 1)).map { it.alsAnsicht() })
        val geschrieben = writeLog()
        ablage.buffer(Editing.SetMenge("2-1", 1))
        assertEquals(listOf("UPDATE 2-1"), geschrieben())
        assertEquals(listOf("1-1", "2-1", "3-1"), ablage.lies(Slots.SETS)!!.liste.map { it.setNumber })
        assertEquals(listOf(1, 2, 1), ablage.lies(Slots.SETS)!!.liste.map { it.quantity })
    }

    @Test
    fun `a discarded item stays in the database until it is acknowledged, and sign-out clears it`() = runBlocking {
        val posten = DiscardedItem("k1", "10001-1", "gibt es nicht", 404)
        ausgang.rememberDiscarded("a", posten)
        // A second access to the same database, as after a restart of the app.
        assertEquals(listOf(posten), RoomExit(db).discarded("a").first())
        assertEquals(emptyList<DiscardedItem>(), ausgang.discarded("b").first())
        assertEquals("keine Liste des Bestands sieht ihn", emptyList<LocalRow>(), bestand.lies("a", StockKind.SETS).liste)
        ausgang.acknowledgeDiscarded("a", "k1")
        assertEquals(emptyList<DiscardedItem>(), ausgang.discarded("a").first())
        ausgang.rememberDiscarded("a", posten.copy(id = "k2"))
        bestand.leere()
        assertEquals(emptyList<DiscardedItem>(), ausgang.discarded("a").first())
    }

    @Test
    fun `an unreadable item is reported, never silently deleted, and does not block`() = runBlocking {
        db.ausgang().addOne(ExitRow(bereich = "a", bearbeitung = "{\"type\":\"gibt_es_nicht\",\"setNumber\":\"10001-1\"}",
            erstellt = 1, schluessel = "k0"))
        ausgang.einreihen("a", Editing.SetMenge("1-1", 1), 2, "k1")
        assertEquals(Editing.SetMenge("1-1", 1), ausgang.erster("a")!!.bearbeitung)
        assertEquals("der Schlüssel kommt so zurück, wie er abgelegt wurde", "k1", ausgang.erster("a")!!.schluessel)
        assertEquals(1, ausgang.alle("a").size)
        assertEquals("Lesen schreibt nicht: der unlesbare Posten liegt noch da", 2, ausgang.anzahl("a").first())

        val sync = Abgleich(Offlineablage(bestand, ausgang, { "a" }), ausgang) { _, _ -> Sendeergebnis.Angenommen }
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        assertEquals(listOf(DiscardedItem("k0", "10001-1", "", null, unlesbar = true)), ausgang.discarded("a").first())
        assertEquals(0, ausgang.anzahl("a").first())
    }
}
