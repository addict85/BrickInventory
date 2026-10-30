package ch.brickinventoryapp

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Bestandsart
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.LokaleZeile
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.lokal.Sendeergebnis
import ch.brickinventoryapp.data.lokal.room.AusgangZeile
import ch.brickinventoryapp.data.lokal.room.BestandDatenbank
import ch.brickinventoryapp.data.lokal.room.RoomAusgang
import ch.brickinventoryapp.data.lokal.room.RoomBestand
import ch.brickinventoryapp.data.model.SetItem
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Room-Ablage selbst (nur in der CI: Room braucht Android). Dieselben
 * Zusagen wie die Ablagen im Speicher, gegen eine echte SQLite-Datenbank.
 *
 * Gegenproben: in der CI zu messen, sobald der Lauf grün ist —
 *   A  in BestandDao.beobachte `ORDER BY position` entfernen → „hält die Reihenfolge“
 *   B  in AusgangDao.erster `ORDER BY id` → `ORDER BY id DESC` → „sendet der Reihe nach“
 *   C  in RoomAusgang.lies das Entfernen weglassen → „ein unlesbarer Posten blockiert nicht“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
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
        assertEquals(listOf("2", "1"), a.zeilen.map { it.schluessel })
        assertEquals(42L, a.stand)
        bestand.raeumeAndere("a")
        assertEquals(emptyList<LokaleZeile>(), bestand.lies("b", Bestandsart.SETS).zeilen)
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
        val abgleich = Abgleich(ablage) { b ->
            if (!netz) Sendeergebnis.Spaeter else { gesendet += (b as Bearbeitung.SetMenge).schritt; Sendeergebnis.Angenommen }
        }
        assertEquals(Abgleichsergebnis.SPAETER, abgleich.sende())
        assertEquals(1, ausgang.erster("a")!!.versuche)
        netz = true
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        assertEquals(listOf(1, 2, 3), gesendet)
        assertEquals(0, ausgang.anzahl("a").first())
    }

    @Test
    fun `ein unlesbarer Posten blockiert nicht`() = runBlocking {
        db.ausgang().fuegeEin(AusgangZeile(bereich = "a", bearbeitung = "{\"type\":\"gibt_es_nicht\"}", erstellt = 1))
        ausgang.einreihen("a", Bearbeitung.SetMenge("1-1", 1), 2)
        assertEquals(Bearbeitung.SetMenge("1-1", 1), ausgang.erster("a")!!.bearbeitung)
        assertEquals(1, ausgang.anzahl("a").first())
    }
}
