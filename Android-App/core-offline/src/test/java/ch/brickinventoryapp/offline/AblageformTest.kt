package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.data.model.BrickLinkRef
import ch.brickinventoryapp.model.data.model.Instruction
import ch.brickinventoryapp.model.data.model.KontoName
import ch.brickinventoryapp.model.data.model.LagerortEintrag
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.MerkpostenAlarm
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.data.model.VorratsOrt
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Bestandsart
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sets, Merkposten und Teile liegen in einer eigenen Ablageform: Jedes Feld kommt
 * unverändert zurück, eine Zeile im Format des Servermodells bleibt lesbar, und eine
 * unlesbare Zeile fällt nicht still weg.
 *
 * Gegenproben (gegenproben/ablageform-felder-vertauscht.patch, verworfen-still.patch):
 *   in Ablagezeilen.set avg und max des Kaufpreises vertauscht → rot „jedes Feld …“
 *   in Offlineablage.dekodiere verworfen = 0 → rot „eine unlesbare Zeile wird gezählt …“
 */
class AblageformTest {

    private fun <T : Any> rund(fach: Fach<T>, wert: T): T = fach.form.dekodiere(BrickJson, fach.form.kodiere(BrickJson, wert))

    // Jedes Feld mit eigenem Wert, damit eine Vertauschung auffällt.
    private val set = SetItem("10001-1", "Burg", 1990, "Castle", 500, 4, 2, "u", "l", "2020-01-01", Zustand.GEBRAUCHT,
        "Kiste 1", listOf(Zustand.NEU, Zustand.GEBRAUCHT), listOf(KontoName(3, "lea")), 99.5, 88.25, 1,
        listOf(Instruction(4, "a.pdf", "Heft 1", "lokal/a.pdf", true)), BrickLinkRef("GEAR", "g1", "bl", false, true), "pv")
    private val merk = Merkposten("20001-1", Zustand.GEBRAUCHT, "2021-02-02", 7, "Schiff", 2001, 900, "u", "l", 12.5,
        Waehrung.CHF, true, MerkpostenAlarm(Alarmrichtung.UEBER, 30.0, true), "pv")
    private val teil = Part("3001", "3001b", "Stein", 5, 11, "Rot", "FF0000", "Steine", "u", "l", 9, "10001-1", true)

    @Test
    fun `jedes Feld von Set, Merkposten und Teil uebersteht die Ablage`() {
        assertEquals(set, rund(Faecher.SETS, set))
        assertEquals(merk, rund(Faecher.MERKLISTE, merk))
        assertEquals(teil, rund(Faecher.TEILE, teil))
        val ort = VorratsOrt(LagerortEintrag(3, 1, "Keller"), vorgabe = true)
        assertEquals(ort, rund(Faecher.LAGERORTE, ort))
    }

    @Test
    fun `eine Zeile im frueheren Format bleibt lesbar`() {
        // Das Servermodell selbst als JSON: so liegen Zeilen, die vor der eigenen Ablageform geschrieben wurden.
        val alt = BrickJson.encodeToString(SetItem.serializer(), set)
        assertEquals(set, Faecher.SETS.form.dekodiere(BrickJson, alt))
        assertEquals(merk, Faecher.MERKLISTE.form.dekodiere(BrickJson, BrickJson.encodeToString(Merkposten.serializer(), merk)))
        assertEquals(teil, Faecher.TEILE.form.dekodiere(BrickJson, BrickJson.encodeToString(Part.serializer(), teil)))
    }

    @Test
    fun `eine unlesbare Zeile wird gezaehlt und gemeldet statt still zu fehlen`() = runBlocking {
        val bestand = SpeicherBestand()
        val meldungen = mutableListOf<String>()
        val ablage = Offlineablage(bestand, SpeicherAusgang(), { "a" }, protokoll = { meldungen += it })
        ablage.uebernimm(Faecher.SETS, listOf(set))
        val heil = bestand.lies("a", Bestandsart.SETS).liste
        bestand.ersetze("a", Bestandsart.SETS, heil + LokaleZeile("kaputt", """{"quantity":"viele"}"""), 1L)
        val lokal = ablage.beobachte(Faecher.SETS).first()
        assertEquals(listOf("10001-1"), lokal.liste.map { it.setNumber })
        assertEquals(1, lokal.verworfen)
        assertTrue(meldungen.joinToString(), meldungen.any { "SETS" in it && "1 von 2" in it })
    }
}
