package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.lokal.Bestandsart
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.data.lokal.Sendeergebnis
import ch.brickinventoryapp.offline.Ausgang.VerworfenerPosten
import ch.brickinventoryapp.offline.room.AusgangZeile
import ch.brickinventoryapp.offline.room.BestandDatenbank
import ch.brickinventoryapp.offline.room.RoomAusgang
import ch.brickinventoryapp.offline.room.RoomBestand
import ch.brickinventoryapp.vertrag.SetItem
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Die Room-Ablage selbst (nur in der CI: Room braucht Android). Dieselben
 * Zusagen wie die Ablagen im Speicher, gegen eine echte SQLite-Datenbank.
 *
 * Gegenproben: in der CI zu messen, sobald der Lauf grün ist —
 *   A  in BestandDao.beobachte `ORDER BY position` entfernen → „hält die Reihenfolge“
 *   B  in AusgangDao.alle `ORDER BY id` → `ORDER BY id DESC` → „sendet der Reihe nach“
 *   C  in RoomAusgang.raeumeUnlesbare das merkeVerworfen streichen → „ein unlesbarer Posten wird
 *      gemeldet …“ (kein Hinweis); in RoomAusgang.alle wieder entfernen → ebenda (Lesen schreibt)
 *   D  in RoomAusgang.lies `z.schluessel` → `""` → „ein unlesbarer Posten …“ (Schlüssel kommt nicht zurück)
 *   gegenproben/ablage-aendert-ganze-liste.patch (Offlineablage.aendere ersetzt wieder die
 *      ganze Liste) → rot „eine lokale Bearbeitung schreibt nur die betroffene Zeile“
 *   gegenproben/verworfen-nie-quittiert.patch (RoomAusgang.quittiereVerworfen löscht nichts)
 *      → rot „ein verworfener Posten bleibt in der Datenbank, bis …“
 */
@RunWith(RobolectricTestRunner::class)
class BestandDatenbankTest {

    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), BestandDatenbank::class.java)
        .allowMainThreadQueries().build()
    private val bestand = RoomBestand(db)
    private val ausgang = RoomAusgang(db)

    @After
    fun zu() = db.close()

    @Test
    fun `hält die Reihenfolge und den Stand je Bereich`() = runBlocking {
        bestand.ersetze("a", Bestandsart.SETS, listOf(LokaleZeile("2", "{}"), LokaleZeile("1", "{}")), 42L)
        bestand.ersetze("b", Bestandsart.SETS, listOf(LokaleZeile("9", "{}")), 7L)
        val a = bestand.beobachte("a", Bestandsart.SETS).first()
        assertEquals(listOf("2", "1"), a.liste.map { it.schluessel })
        assertEquals(42L, a.stand)
        bestand.raeumeAndere("a")
        assertEquals(emptyList<LokaleZeile>(), bestand.lies("b", Bestandsart.SETS).liste)
        assertNull(bestand.lies("b", Bestandsart.SETS).stand)
    }

    @Test
    fun `eine lokale Änderung behält den Serverstand`() = runBlocking {
        bestand.ersetze("a", Bestandsart.SETS, listOf(LokaleZeile("1", "{}")), 42L)
        bestand.ersetze("a", Bestandsart.SETS, listOf(LokaleZeile("1", "{}"), LokaleZeile("2", "{}")), null)
        assertEquals(42L, bestand.lies("a", Bestandsart.SETS).stand)
    }

    @Test
    fun `sendet der Reihe nach und zählt Versuche`() = runBlocking {
        val ablage = Offlineablage(bestand, ausgang, { "a" })
        ablage.uebernimm(Faecher.SETS, listOf(SetItem(setNumber = "1-1", quantity = 1)))
        for (n in 1..3) ablage.puffere(Bearbeitung.SetMenge("1-1", n))
        assertEquals(3, ausgang.anzahl("a").first())
        assertEquals(7, ablage.lies(Faecher.SETS)!!.liste.single().quantity)
        val gesendet = mutableListOf<Int>()
        var netz = false
        val schluessel = mutableSetOf<String>()
        val abgleich = Abgleich(ablage, ausgang) { b, k ->
            schluessel += k
            if (!netz) Sendeergebnis.Spaeter else { gesendet += (b as Bearbeitung.SetMenge).schritt; Sendeergebnis.Angenommen }
        }
        assertEquals(Abgleichsergebnis.SPAETER, abgleich.sende())
        assertEquals(1, ausgang.erster("a")!!.versuche)
        netz = true
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        assertEquals(listOf(1, 2, 3), gesendet)
        assertEquals("der erste Posten trug bei beiden Versuchen denselben Schlüssel", 3, schluessel.size)
        assertEquals(0, ausgang.anzahl("a").first())
    }

    /** Schreibt jedes INSERT, UPDATE und DELETE auf `bestand` in eine Protokolltabelle. */
    private fun protokolliereSchreiben(): () -> List<String> {
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
    fun `eine lokale Bearbeitung schreibt nur die betroffene Zeile`() = runBlocking {
        val ablage = Offlineablage(bestand, ausgang, { "a" })
        ablage.uebernimm(Faecher.SETS, listOf(SetItem("1-1", quantity = 1), SetItem("2-1", quantity = 1), SetItem("3-1", quantity = 1)))
        val geschrieben = protokolliereSchreiben()
        ablage.puffere(Bearbeitung.SetMenge("2-1", 1))
        assertEquals(listOf("UPDATE 2-1"), geschrieben())
        assertEquals(listOf("1-1", "2-1", "3-1"), ablage.lies(Faecher.SETS)!!.liste.map { it.setNumber })
        assertEquals(listOf(1, 2, 1), ablage.lies(Faecher.SETS)!!.liste.map { it.quantity })
    }

    @Test
    fun `ein verworfener Posten bleibt in der Datenbank, bis er quittiert ist, und Abmelden raeumt ihn`() = runBlocking {
        val posten = VerworfenerPosten("k1", "10001-1", "gibt es nicht", 404)
        ausgang.merkeVerworfen("a", posten)
        // Ein zweiter Zugang zur selben Datenbank, wie nach einem Neustart der App.
        assertEquals(listOf(posten), RoomAusgang(db).verworfene("a").first())
        assertEquals(emptyList<VerworfenerPosten>(), ausgang.verworfene("b").first())
        assertEquals("keine Liste des Bestands sieht ihn", emptyList<LokaleZeile>(), bestand.lies("a", Bestandsart.SETS).liste)
        ausgang.quittiereVerworfen("a", "k1")
        assertEquals(emptyList<VerworfenerPosten>(), ausgang.verworfene("a").first())
        ausgang.merkeVerworfen("a", posten.copy(id = "k2"))
        bestand.leere()
        assertEquals(emptyList<VerworfenerPosten>(), ausgang.verworfene("a").first())
    }

    @Test
    fun `ein unlesbarer Posten wird gemeldet, nie still gelöscht, und blockiert nicht`() = runBlocking {
        db.ausgang().fuegeEin(AusgangZeile(bereich = "a", bearbeitung = "{\"type\":\"gibt_es_nicht\",\"setNumber\":\"10001-1\"}",
            erstellt = 1, schluessel = "k0"))
        ausgang.einreihen("a", Bearbeitung.SetMenge("1-1", 1), 2, "k1")
        assertEquals(Bearbeitung.SetMenge("1-1", 1), ausgang.erster("a")!!.bearbeitung)
        assertEquals("der Schlüssel kommt so zurück, wie er abgelegt wurde", "k1", ausgang.erster("a")!!.schluessel)
        assertEquals(1, ausgang.alle("a").size)
        assertEquals("Lesen schreibt nicht: der unlesbare Posten liegt noch da", 2, ausgang.anzahl("a").first())

        val abgleich = Abgleich(Offlineablage(bestand, ausgang, { "a" }), ausgang) { _, _ -> Sendeergebnis.Angenommen }
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        assertEquals(listOf(VerworfenerPosten("k0", "10001-1", "", null, unlesbar = true)), ausgang.verworfene("a").first())
        assertEquals(0, ausgang.anzahl("a").first())
    }
}
